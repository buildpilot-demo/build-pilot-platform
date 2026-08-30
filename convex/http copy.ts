import {
  actionGeneric,
  type FunctionReference,
  type GenericActionCtx,
  type GenericDataModel,
  httpActionGeneric,
  httpRouter,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
} from "convex/server";
import { v, type GenericId, type Value } from "convex/values";

import { callExternal, type ExternalCallContext, type ExternalCallMetadata } from "./lib/externalCall.js";
import { transitionProject, type StateMachineContext } from "./stateMachine.js";


declare const process: { env: Record<string, string | undefined> };

type TwilioStatusResult = { duplicate: boolean };
type TranscriptResult = { duplicate: boolean; projectId?: GenericId<"projects"> };

const recordTwilioStatusReference = makeFunctionReference<"mutation">(
  "http:recordTwilioStatus",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  { payload: Record<string, string>; signatureValidated: boolean; replay: boolean },
  TwilioStatusResult
>;

const recordElevenLabsTranscriptReference = makeFunctionReference<"mutation">(
  "http:recordElevenLabsTranscript",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  {
    conversationId: string;
    providerTranscriptId?: string;
    eventType: string;
    text: string;
    language?: string;
    speakerTurns?: Value;
    payload: Value;
    signatureValidated: boolean;
    replay: boolean;
  },
  TranscriptResult
>;

const extractRequirementsReference = makeFunctionReference<"action">(
  "requirements:extractRequirements",
) as unknown as FunctionReference<
  "action",
  "internal",
  { projectId: GenericId<"projects"> },
  unknown
>;

const resolveTwilioProjectReference = makeFunctionReference<"query">(
  "http:resolveTwilioProject",
);
const resolveElevenLabsProjectReference = makeFunctionReference<"query">(
  "http:resolveElevenLabsProject",
);
const prepareInboundReplayReference = makeFunctionReference<"mutation">(
  "http:prepareInboundReplay",
);
const resolveProjectByCorrelationIdReference = makeFunctionReference<"query">(
  "http:resolveProjectByCorrelationId",
) as unknown as FunctionReference<"query", "internal", { correlationId: string }, InboundProject | null>;

// Optional low-latency supplement to the polling reconcile actions
// (devin:reconcileCandidateValidation, deployments:reconcileFirebaseDeployment)
// that Convex already schedules on a fixed interval — see T4.6/T4.10. Those
// actions remain the source of truth and are safe to call redundantly (each
// guards against re-entry once a build/deployment has moved past the
// relevant status), so this callback only needs to nudge the right one to
// run immediately instead of waiting for its next scheduled poll.
// NOTE: "validate-repository" (github:reconcileRepositoryValidation) was
// removed along with the validate-repository.yml GitHub Actions dispatch —
// repository preparation no longer has a separate validation step to
// reconcile, since the seed commit is generated from a pinned/verified
// starter template. See convex/github.ts::prepareRepository.
const GITHUB_WORKFLOW_RECONCILERS = {
  "validate-candidate": makeFunctionReference<"action">("devin:reconcileCandidateValidation"),
  "deploy-firebase": makeFunctionReference<"action">("deployments:reconcileFirebaseDeployment"),
} as const;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

async function hmac(algorithm: "SHA-1" | "SHA-256", secret: string, value: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: algorithm },
    false,
    ["sign"],
  );
  return await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
}

function base64(buffer: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validateTwilioSignature(
  request: Request,
  payload: Record<string, string>,
): Promise<boolean> {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!authToken) return false;
  const signature = request.headers.get("x-twilio-signature")?.trim();
  if (!signature) return false;
  const callbackUrl = process.env.TWILIO_STATUS_CALLBACK_URL?.trim() || request.url;
  const sorted = Object.entries(payload).sort(([left], [right]) => left.localeCompare(right));
  const signedValue = callbackUrl + sorted.map(([key, value]) => `${key}${value}`).join("");
  const expected = base64(await hmac("SHA-1", authToken, signedValue));
  return constantTimeEqual(signature, expected);
}

async function validateElevenLabsSignature(request: Request, rawBody: string): Promise<boolean> {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("elevenlabs-signature")?.trim();
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const separator = part.indexOf("=");
      return separator < 0 ? [part.trim(), ""] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v0;
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) return false;
  const expected = hex(await hmac("SHA-256", secret, `${timestamp}.${rawBody}`));
  return constantTimeEqual(signature.toLowerCase(), expected);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function transcriptText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((turn) => {
      const record = objectValue(turn);
      if (!record) return "";
      const text = stringValue(record.message, record.text, record.content);
      if (!text) return "";
      const speaker = stringValue(record.role, record.speaker);
      return speaker ? `${speaker}: ${text}` : text;
    })
    .filter(Boolean)
    .join("\n");
}

type InboundActionContext = GenericActionCtx<GenericDataModel>;

type InboundProject = {
  projectId: GenericId<"projects">;
  correlationId: string;
};

async function processTwilioStatus(
  ctx: InboundActionContext,
  project: InboundProject,
  payload: Record<string, string>,
  signatureValidated: boolean,
) {
  const cacheKey = `${payload.MessageSid}:${payload.MessageStatus.toLowerCase()}`;
  return await callExternal<Value, TwilioStatusResult>(ctx as ExternalCallContext, {
    projectId: project.projectId,
    stage: "TWILIO_DELIVERY_STATUS",
    version: cacheKey,
    cacheKey,
    provider: "twilio",
    correlationId: project.correlationId,
    replayHandler: {
      functionName: "http:replayTwilioStatus",
      args: { payload, signatureValidated: true },
    },
    providerRequestId: () => payload.MessageSid,
    reconcile: async () => ({ status: "not_found" }),
    live: async () => payload,
    process: async (response, metadata) => {
      if (metadata.mode === "replay") {
        await ctx.runMutation(prepareInboundReplayReference, {
          projectId: project.projectId,
          stage: "TWILIO_DELIVERY_STATUS",
        });
      }
      return await ctx.runMutation(recordTwilioStatusReference, {
        payload: response as Record<string, string>,
        signatureValidated,
        replay: metadata.mode === "replay",
      });
    },
  });
}

async function processElevenLabsTranscript(
  ctx: InboundActionContext,
  project: InboundProject,
  args: {
    conversationId: string;
    providerTranscriptId?: string;
    eventType: string;
    text: string;
    language?: string;
    speakerTurns?: Value;
    payload: Value;
    signatureValidated: boolean;
  },
) {
  return await callExternal<Value, TranscriptResult>(ctx as ExternalCallContext, {
    projectId: project.projectId,
    stage: "ELEVENLABS_CALL_RESULT",
    version: args.conversationId,
    cacheKey: args.conversationId,
    provider: "elevenlabs",
    correlationId: project.correlationId,
    replayHandler: {
      functionName: "http:replayElevenLabsTranscript",
      args,
    },
    providerRequestId: () => args.conversationId,
    reconcile: async () => ({ status: "not_found" }),
    live: async () => args.payload,
    process: async (_response, metadata) => {
      if (metadata.mode === "replay") {
        await ctx.runMutation(prepareInboundReplayReference, {
          projectId: project.projectId,
          stage: "ELEVENLABS_CALL_RESULT",
        });
      }
      const result = await ctx.runMutation(recordElevenLabsTranscriptReference, {
        ...args,
        replay: metadata.mode === "replay",
      });
      if (!result.duplicate && result.projectId) {
        await ctx.scheduler.runAfter(0, extractRequirementsReference, {
          projectId: result.projectId,
        });
      }
      return result;
    },
  });
}

export const replayTwilioStatus = actionGeneric({
  args: {
    projectId: v.id("projects"),
    payload: v.any(),
    signatureValidated: v.boolean(),
  },
  handler: async (ctx, args) => {
    // NOTE: Admin authentication is intentionally disabled for now; any user
    // can call this. Authentication will be added back in a future pass.
    return await processTwilioStatus(
      ctx,
      (await ctx.runQuery(resolveTwilioProjectReference, {
        messageSid: (args.payload as Record<string, string>).MessageSid,
      })) as InboundProject,
      args.payload as Record<string, string>,
      args.signatureValidated,
    );
  },
});

export const replayElevenLabsTranscript = actionGeneric({
  args: {
    projectId: v.id("projects"),
    conversationId: v.string(),
    providerTranscriptId: v.optional(v.string()),
    eventType: v.string(),
    text: v.string(),
    language: v.optional(v.string()),
    speakerTurns: v.optional(v.any()),
    payload: v.any(),
    signatureValidated: v.boolean(),
  },
  handler: async (ctx, args) => {
    // NOTE: Admin authentication is intentionally disabled for now; any user
    // can call this. Authentication will be added back in a future pass.
    return await processElevenLabsTranscript(
      ctx,
      (await ctx.runQuery(resolveElevenLabsProjectReference, {
        conversationId: args.conversationId,
      })) as InboundProject,
      args,
    );
  },
});

const twilioStatus = httpActionGeneric(async (ctx, request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const rawBody = await request.text();
  const form = new URLSearchParams(rawBody);
  const payload: Record<string, string> = {};
  form.forEach((value, key) => {
    payload[key] = value;
  });
  const configured = Boolean(process.env.TWILIO_AUTH_TOKEN?.trim());
  if (!configured) return jsonResponse({ error: "Twilio webhook verification is not configured" }, 503);
  const signatureValidated = await validateTwilioSignature(request, payload);
  if (!signatureValidated) return jsonResponse({ error: "Invalid signature" }, 401);
  if (!payload.MessageSid || !payload.MessageStatus) {
    return jsonResponse({ error: "MessageSid and MessageStatus are required" }, 400);
  }
  try {
    const project = (await ctx.runQuery(resolveTwilioProjectReference, {
      messageSid: payload.MessageSid,
    })) as InboundProject | null;
    const result = project
      ? await processTwilioStatus(ctx, project, payload, signatureValidated)
      : await ctx.runMutation(recordTwilioStatusReference, {
          payload,
          signatureValidated,
          replay: false,
        });
    return jsonResponse({ ok: true, duplicate: result.duplicate });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Callback processing failed" }, 400);
  }
});

const elevenLabsTranscript = httpActionGeneric(async (ctx, request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const rawBody = await request.text();
  const configured = Boolean(process.env.ELEVENLABS_WEBHOOK_SECRET?.trim());
  if (!configured) return jsonResponse({ error: "ElevenLabs webhook verification is not configured" }, 503);
  const signatureValidated = await validateElevenLabsSignature(request, rawBody);
  if (!signatureValidated) return jsonResponse({ error: "Invalid signature" }, 401);
  let payload: Record<string, unknown>;
  try {
    payload = objectValue(JSON.parse(rawBody)) ?? {};
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  const data = objectValue(payload.data) ?? payload;
  const conversationId = stringValue(
    payload.conversation_id,
    payload.conversationId,
    data.conversation_id,
    data.conversationId,
  );
  if (!conversationId) return jsonResponse({ error: "Conversation ID is required" }, 400);
  const transcript = data.transcript ?? payload.transcript;
  const text = transcriptText(transcript);
  if (!text) return jsonResponse({ error: "Transcript is required" }, 400);
  const providerTranscriptId = stringValue(
    payload.transcript_id,
    data.transcript_id,
    payload.event_id,
    data.event_id,
  );
  const eventType = stringValue(payload.type, payload.event_type, data.type) ?? "post_call_transcription";
  const language = stringValue(data.language, data.language_code, payload.language);
  try {
    const project = (await ctx.runQuery(resolveElevenLabsProjectReference, {
      conversationId,
    })) as InboundProject | null;
    if (!project) throw new Error(`Voice session ${conversationId} was not found`);
    const result = await processElevenLabsTranscript(ctx, project, {
      conversationId,
      providerTranscriptId,
      eventType,
      text,
      language,
      speakerTurns: transcript as Value,
      payload: payload as Value,
      signatureValidated,
    });
    return jsonResponse({ ok: true, duplicate: result.duplicate });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Callback processing failed" }, 400);
  }
});

const githubWorkflowCallback = httpActionGeneric(async (ctx, request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const token = process.env.CONVEX_CALLBACK_TOKEN?.trim();
  if (!token) return jsonResponse({ error: "GitHub workflow callback is not configured" }, 503);
  const authorization = request.headers.get("authorization") ?? "";
  const presented = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  if (!presented || !constantTimeEqual(presented, token)) return jsonResponse({ error: "Invalid callback token" }, 401);

  let payload: Record<string, unknown>;
  try {
    payload = objectValue(JSON.parse(await request.text())) ?? {};
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  const workflow = stringValue(payload.workflow);
  const correlationId = stringValue(payload.correlation_id, payload.correlationId);
  if (!workflow || !correlationId) return jsonResponse({ error: "workflow and correlation_id are required" }, 400);
  const reconcileReference = (GITHUB_WORKFLOW_RECONCILERS as Record<string, FunctionReference<"action"> | undefined>)[workflow];
  if (!reconcileReference) return jsonResponse({ error: `Unknown workflow: ${workflow}` }, 400);

  const project = (await ctx.runQuery(resolveProjectByCorrelationIdReference, { correlationId })) as InboundProject | null;
  if (!project) return jsonResponse({ error: `No project found for correlation ${correlationId}` }, 404);

  await ctx.scheduler.runAfter(0, reconcileReference, { projectId: project.projectId });
  return jsonResponse({ ok: true });
});

export const resolveTwilioProject = internalQueryGeneric({
  args: { messageSid: v.string() },
  handler: async (ctx, args): Promise<InboundProject | null> => {
    const message = await ctx.db
      .query("whatsappMessages")
      .withIndex("by_message_sid", (query) => query.eq("provider", "twilio"))
      .filter((query) => query.eq(query.field("messageSid"), args.messageSid))
      .first();
    if (!message?.projectId) return null;
    const project = await ctx.db.get("projects", message.projectId);
    return project
      ? { projectId: project._id, correlationId: project.correlationId }
      : null;
  },
});

export const resolveElevenLabsProject = internalQueryGeneric({
  args: { conversationId: v.string() },
  handler: async (ctx, args): Promise<InboundProject | null> => {
    const voiceSession = await ctx.db
      .query("voiceSessions")
      .withIndex("by_conversation_id", (query) =>
        query.eq("conversationId", args.conversationId),
      )
      .first();
    if (!voiceSession) return null;
    const project = await ctx.db.get("projects", voiceSession.projectId);
    return project
      ? { projectId: project._id, correlationId: project.correlationId }
      : null;
  },
});

export const resolveProjectByCorrelationId = internalQueryGeneric({
  args: { correlationId: v.string() },
  handler: async (ctx, args): Promise<InboundProject | null> => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_correlation_id", (query) => query.eq("correlationId", args.correlationId))
      .first();
    return project ? { projectId: project._id, correlationId: project.correlationId } : null;
  },
});

export const prepareInboundReplay = internalMutationGeneric({
  args: {
    projectId: v.id("projects"),
    stage: v.union(
      v.literal("TWILIO_DELIVERY_STATUS"),
      v.literal("ELEVENLABS_CALL_RESULT"),
    ),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project?.workflowRunId || project.state !== "MANUAL_INTERVENTION_REQUIRED") {
      return null;
    }
    if (args.stage === "TWILIO_DELIVERY_STATUS") {
      await transitionProject(ctx as unknown as StateMachineContext, project._id, "NOTIFICATION_PENDING", {
        correlationId: project.correlationId,
        stage: args.stage,
        workflowRunId: project.workflowRunId,
      });
    } else {
      await transitionProject(ctx as unknown as StateMachineContext, project._id, "CALL_QUEUED", {
        correlationId: project.correlationId,
        stage: args.stage,
        workflowRunId: project.workflowRunId,
      });
      await transitionProject(ctx as unknown as StateMachineContext, project._id, "CALLING", {
        correlationId: project.correlationId,
        stage: args.stage,
        workflowRunId: project.workflowRunId,
      });
    }
    return null;
  },
});

export const recordTwilioStatus = internalMutationGeneric({
  args: { payload: v.any(), signatureValidated: v.boolean(), replay: v.boolean() },
  handler: async (ctx, args): Promise<TwilioStatusResult> => {
    const payload = args.payload as Record<string, string>;
    const messageSid = payload.MessageSid;
    const status = payload.MessageStatus.toLowerCase();
    const providerEventId = `${messageSid}:${status}`;
    const existingEvent = await ctx.db
      .query("webhookEvents")
      .filter((query) =>
        query.and(
          query.eq(query.field("provider"), "twilio"),
          query.eq(query.field("providerEventId"), providerEventId),
        ),
      )
      .first();
    if (
      !args.replay &&
      (existingEvent?.status === "processed" || existingEvent?.status === "ignored")
    ) {
      return { duplicate: true };
    }
    const message = await ctx.db
      .query("whatsappMessages")
      .filter((query) =>
        query.and(
          query.eq(query.field("provider"), "twilio"),
          query.eq(query.field("messageSid"), messageSid),
        ),
      )
      .first();
    const now = Date.now();
    const eventValue = {
      provider: "twilio",
      providerEventId,
      eventType: "message_status",
      status: "processing" as const,
      signatureValidated: args.signatureValidated,
      projectId: message?.projectId,
      payload,
      receivedAt: existingEvent?.receivedAt ?? now,
    };
    const eventId = existingEvent
      ? (await ctx.db.patch("webhookEvents", existingEvent._id, eventValue), existingEvent._id)
      : await ctx.db.insert("webhookEvents", eventValue);
    if (!message) {
      await ctx.db.insert("whatsappMessages", {
        provider: "twilio",
        messageSid,
        direction: "outbound",
        from: payload.From || "unknown",
        to: payload.To || "unknown",
        mediaCount: 0,
        status,
        updatedAt: now,
      });
      await ctx.db.patch("webhookEvents", eventId, { status: "processed", processedAt: now });
      return { duplicate: false };
    }
    await ctx.db.patch("whatsappMessages", message._id, { status, updatedAt: now });
    const notification = await ctx.db
      .query("notifications")
      .filter((query) =>
        query.and(
          query.eq(query.field("provider"), "twilio"),
          query.eq(query.field("messageSid"), messageSid),
        ),
      )
      .first();
    if (notification) {
      await ctx.db.patch("notifications", notification._id, {
        status,
        updatedAt: now,
        deliveredAt: status === "delivered" || status === "read" ? now : notification.deliveredAt,
        ...(payload.ErrorCode ? { errorCode: payload.ErrorCode, errorMessage: payload.ErrorMessage } : {}),
      });
    }
    if (message.projectId) {
      const project = await ctx.db.get("projects", message.projectId);
      if (project && (status === "delivered" || status === "read")) {
        if (message.revisionRequestId) {
          const revision = await ctx.db.get("revisionRequests", message.revisionRequestId);
          if (revision?.status === "REVISION_NOTIFICATION_PENDING") {
            await transitionProject(ctx as unknown as StateMachineContext, project._id, "REVISION_COMPLETED", {
              correlationId: project.correlationId,
              stage: "WHATSAPP_DELIVERY_STATUS",
              workflowRunId: revision.workflowRunId,
              revisionRequestId: revision._id,
            });
          }
        } else if (project.state === "NOTIFICATION_PENDING") {
          await transitionProject(ctx as unknown as StateMachineContext, project._id, "DELIVERED", {
            correlationId: project.correlationId,
            stage: "WHATSAPP_DELIVERY_STATUS",
            workflowRunId: project.workflowRunId,
          });
        }
      }
      if (project && (status === "failed" || status === "undelivered")) {
        const metadata = {
          correlationId: project.correlationId,
          stage: "WHATSAPP_DELIVERY_STATUS",
          failedStage: "WHATSAPP_DELIVERY",
          errorCode: payload.ErrorCode || "TWILIO_DELIVERY_FAILED",
          errorMessage: payload.ErrorMessage || `Twilio message status is ${status}`,
          retryable: status === "undelivered",
          retryCount: 1,
          maxRetries: 3,
          provider: "twilio",
          providerRequestId: messageSid,
          lastAttemptAt: now,
        };
        if (message.revisionRequestId) {
          const revision = await ctx.db.get("revisionRequests", message.revisionRequestId);
          if (revision?.status === "REVISION_NOTIFICATION_PENDING") {
            await transitionProject(ctx as unknown as StateMachineContext, project._id, "REVISION_NOTIFICATION_FAILED", {
              ...metadata,
              workflowRunId: revision.workflowRunId,
              revisionRequestId: revision._id,
            });
          }
        } else if (project.state === "NOTIFICATION_PENDING") {
          await transitionProject(ctx as unknown as StateMachineContext, project._id, "NOTIFICATION_FAILED", {
            ...metadata,
            workflowRunId: project.workflowRunId,
          });
        }
      }
    }
    await ctx.db.patch("webhookEvents", eventId, { status: "processed", processedAt: now });
    return { duplicate: false };
  },
});

export const recordElevenLabsTranscript = internalMutationGeneric({
  args: {
    conversationId: v.string(),
    providerTranscriptId: v.optional(v.string()),
    eventType: v.string(),
    text: v.string(),
    language: v.optional(v.string()),
    speakerTurns: v.optional(v.any()),
    payload: v.any(),
    signatureValidated: v.boolean(),
    replay: v.boolean(),
  },
  handler: async (ctx, args): Promise<TranscriptResult> => {
    const existingEvent = await ctx.db
      .query("webhookEvents")
      .filter((query) =>
        query.and(
          query.eq(query.field("provider"), "elevenlabs"),
          query.eq(query.field("providerEventId"), args.conversationId),
        ),
      )
      .first();
    if (!args.replay && existingEvent?.status === "processed") {
      return { duplicate: true, projectId: existingEvent.projectId };
    }
    const voiceSession = await ctx.db
      .query("voiceSessions")
      .filter((query) => query.eq(query.field("conversationId"), args.conversationId))
      .first();
    if (!voiceSession) throw new Error(`Voice session ${args.conversationId} was not found`);
    const project = await ctx.db.get("projects", voiceSession.projectId);
    if (!project) throw new Error(`Project ${voiceSession.projectId} was not found`);
    const now = Date.now();
    const eventValue = {
      provider: "elevenlabs",
      providerEventId: args.conversationId,
      eventType: args.eventType,
      status: "processing" as const,
      signatureValidated: args.signatureValidated,
      projectId: project._id,
      workflowRunId: voiceSession.workflowRunId,
      correlationId: project.correlationId,
      payload: args.payload,
      receivedAt: existingEvent?.receivedAt ?? now,
    };
    const eventId = existingEvent
      ? (await ctx.db.patch("webhookEvents", existingEvent._id, eventValue), existingEvent._id)
      : await ctx.db.insert("webhookEvents", eventValue);
    const transcriptIdentity = args.providerTranscriptId ?? args.conversationId;
    const existingTranscript = await ctx.db
      .query("transcripts")
      .filter((query) =>
        query.and(
          query.eq(query.field("provider"), "elevenlabs"),
          query.eq(query.field("providerTranscriptId"), transcriptIdentity),
        ),
      )
      .first();
    if (!existingTranscript) {
      await ctx.db.insert("transcripts", {
        projectId: project._id,
        workflowRunId: voiceSession.workflowRunId,
        voiceSessionId: voiceSession._id,
        provider: "elevenlabs",
        providerTranscriptId: transcriptIdentity,
        text: args.text,
        language: args.language,
        speakerTurns: args.speakerTurns,
        rawPayload: args.payload,
        receivedAt: now,
        createdAt: now,
      });
    }
    await ctx.db.patch("voiceSessions", voiceSession._id, {
      status: "completed",
      completedAt: voiceSession.completedAt ?? now,
      updatedAt: now,
    });
    if (project.state === "CALLING") {
      await transitionProject(ctx as unknown as StateMachineContext, project._id, "CALL_COMPLETED", {
        correlationId: project.correlationId,
        stage: "ELEVENLABS_TRANSCRIPT",
        workflowRunId: voiceSession.workflowRunId,
      });
    }
    const refreshedProject = await ctx.db.get("projects", project._id);
    if (refreshedProject?.state === "CALL_COMPLETED") {
      await transitionProject(ctx as unknown as StateMachineContext, project._id, "TRANSCRIPT_RECEIVED", {
        correlationId: project.correlationId,
        stage: "ELEVENLABS_TRANSCRIPT",
        workflowRunId: voiceSession.workflowRunId,
      });
    }
    await ctx.db.patch("webhookEvents", eventId, { status: "processed", processedAt: now });
    return { duplicate: false, projectId: project._id };
  },
});

const http = httpRouter();
http.route({ path: "/webhooks/twilio-status", method: "POST", handler: twilioStatus });
http.route({ path: "/webhooks/elevenlabs", method: "POST", handler: elevenLabsTranscript });
http.route({ path: "/webhooks/github-workflow", method: "POST", handler: githubWorkflowCallback });

export default http;
