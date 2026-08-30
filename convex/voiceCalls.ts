import {
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import { v, type GenericId, type Value } from "convex/values";

import { callExternal, type ExternalCallContext } from "./lib/externalCall.js";
import { mockTranscriptText, selectMockConversation } from "./lib/mockConversations.js";
import { transitionProject, type StateMachineContext } from "./stateMachine.js";

declare const process: { env: Record<string, string | undefined> };

type CallContext = {
  projectId: GenericId<"projects">;
  workflowRunId: GenericId<"workflowRuns">;
  correlationId: string;
  business: {
    name: string;
    category: string;
    targetPhone: string;
    address?: string;
    city?: string;
    area?: string;
    timezone?: string;
  };
  attemptNumber: number;
};

type VoiceResponse = {
  conversationId: string;
  twilioCallSid?: string;
  status: string;
};

type TranscriptResult = { duplicate: boolean; projectId?: GenericId<"projects"> };

const contextReference = makeFunctionReference<"query">("voiceCalls:getCallContext") as unknown as FunctionReference<"query", "internal", { projectId: GenericId<"projects"> }, CallContext>;
const queueReference = makeFunctionReference<"mutation">("voiceCalls:queueCall") as unknown as FunctionReference<"mutation", "internal", { projectId: GenericId<"projects"> }, { voiceSessionId: GenericId<"voiceSessions">; callAttemptId: GenericId<"callAttempts">; attemptNumber: number }>;
const startedReference = makeFunctionReference<"mutation">("voiceCalls:recordCallStarted") as unknown as FunctionReference<"mutation", "internal", { projectId: GenericId<"projects">; voiceSessionId: GenericId<"voiceSessions">; callAttemptId: GenericId<"callAttempts">; response: VoiceResponse }, null>;
const failedReference = makeFunctionReference<"mutation">("voiceCalls:recordCallFailure") as unknown as FunctionReference<"mutation", "internal", { projectId: GenericId<"projects">; voiceSessionId: GenericId<"voiceSessions">; callAttemptId: GenericId<"callAttempts">; errorCode: string; message: string; retryable: boolean; providerRequestId: string }, null>;
// Re-uses the same webhook-processing mutation/action the real ElevenLabs
// callback hits (see http.ts) so a mocked conversation drives the state
// machine (CALLING -> CALL_COMPLETED -> TRANSCRIPT_RECEIVED) and downstream
// requirements extraction identically to a live call.
const recordTranscriptReference = makeFunctionReference<"mutation">("http:recordElevenLabsTranscript") as unknown as FunctionReference<
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
const extractRequirementsReference = makeFunctionReference<"action">("requirements:extractRequirements") as unknown as FunctionReference<"action", "internal", { projectId: GenericId<"projects"> }, unknown>;

// T-mock: ELEVENLABS_MOCK_CONVERSATION=Y skips the real ElevenLabs/Twilio
// call entirely and instead simulates one using a canned transcript from
// convex/data/mockConversations.json, so the rest of the pipeline can be
// tested end-to-end without live telephony. Set to "N" (or leave unset) to
// keep the real ElevenLabs flow unchanged.
function isMockConversationEnabled(): boolean {
  return (process.env.ELEVENLABS_MOCK_CONVERSATION ?? "N").trim().toUpperCase() === "Y";
}

function hourInTimezone(timezone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).find((part) => part.type === "hour")?.value;
  if (!hour) throw new Error(`Unable to determine calling window for timezone ${timezone}`);
  return Number(hour);
}

function validateCallingWindow(timezone: string): void {
  const start = Number(process.env.CALLING_WINDOW_START_HOUR ?? "9");
  const end = Number(process.env.CALLING_WINDOW_END_HOUR ?? "18");
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 24 || start >= end) throw new Error("Calling window environment is invalid");
  const hour = hourInTimezone(timezone);
  if (hour < start || hour >= end) throw new Error(`Calling is only allowed from ${start}:00 to ${end}:00 in ${timezone}`);
}

function responseRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") throw new Error("ElevenLabs returned an invalid response");
  return payload as Record<string, unknown>;
}

function pickString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof record[key] === "string" && (record[key] as string).trim()) return (record[key] as string).trim();
  }
  return undefined;
}

// Internal: reachable only from server-side code (ctx.scheduler, the new
// admin-gated retryCall wrapper in retryActions.ts) — never directly by a
// client/raw API call (T7.4, Section 12).
export const startCall = internalActionGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const callContext = await ctx.runQuery(contextReference, { projectId: args.projectId });
    validateCallingWindow(callContext.business.timezone ?? "Asia/Dubai");

    if (isMockConversationEnabled()) {
      const queued = await ctx.runMutation(queueReference, { projectId: args.projectId });
      const conversation = selectMockConversation(String(args.projectId), callContext.business.category, callContext.business.name);
      const conversationId = `mock-${args.projectId}-${queued.attemptNumber}-${Date.now()}`;
      const response: VoiceResponse = { conversationId, status: "calling" };
      await ctx.runMutation(startedReference, { projectId: args.projectId, voiceSessionId: queued.voiceSessionId, callAttemptId: queued.callAttemptId, response });
      const transcriptResult = await ctx.runMutation(recordTranscriptReference, {
        conversationId,
        providerTranscriptId: `${conversationId}-transcript`,
        eventType: "post_call_transcription_mock",
        text: mockTranscriptText(conversation),
        language: conversation.language ?? "en",
        speakerTurns: conversation.transcript as unknown as Value,
        payload: { mock: true, conversationId, industry: conversation.industry, businessName: conversation.businessName } as unknown as Value,
        signatureValidated: true,
        replay: false,
      });
      if (!transcriptResult.duplicate && transcriptResult.projectId) {
        await ctx.scheduler.runAfter(0, extractRequirementsReference, { projectId: transcriptResult.projectId });
      }
      return { ...response, voiceSessionId: queued.voiceSessionId, mock: true, mockConversationId: conversation.id };
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const agentId = process.env.ELEVENLABS_AGENT_ID;
    const agentPhoneNumberId = process.env.ELEVENLABS_AGENT_PHONE_NUMBER_ID;
    const baseUrl = (process.env.ELEVENLABS_BASE_URL ?? "https://api.elevenlabs.io").replace(/\/$/, "");
    if (!apiKey || !agentId || !agentPhoneNumberId) throw new Error("ElevenLabs environment is not configured");

    const queued = await ctx.runMutation(queueReference, { projectId: args.projectId });
    try {
      const response = await callExternal<VoiceResponse>(ctx as unknown as ExternalCallContext, {
        stage: "VOICE_CALL",
        projectId: args.projectId,
        version: queued.attemptNumber,
        cacheKey: "default",
        provider: "elevenlabs",
        correlationId: callContext.correlationId,
        replayHandler: { functionName: "voiceCalls:startCall" },
        live: async (attempt) => {
          const request = await fetch(`${baseUrl}/v1/convai/twilio/outbound-call`, {
            method: "POST",
            headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              agent_id: agentId,
              agent_phone_number_id: agentPhoneNumberId,
              to_number: callContext.business.targetPhone,
              conversation_initiation_client_data: {
                dynamic_variables: {
                  business_name: callContext.business.name,
                  business_category: callContext.business.category,
                  business_address: callContext.business.address ?? "",
                  business_city: callContext.business.city ?? "",
                  business_area: callContext.business.area ?? "",
                  project_id: args.projectId,
                },
              },
            }),
          });
          if (!request.ok) throw new Error(`ElevenLabs returned HTTP ${request.status}: ${(await request.text()).slice(0, 300)}`);
          const payload = responseRecord(await request.json());
          const conversationId = pickString(payload, "conversation_id", "conversationId");
          if (!conversationId) throw new Error("ElevenLabs response did not include a conversation ID");
          await attempt.recordProviderRequest(conversationId);
          const twilioCallSid = pickString(payload, "callSid", "call_sid", "twilio_call_sid", "twilioCallSid");
          return twilioCallSid ? { conversationId, twilioCallSid, status: "calling" } : { conversationId, status: "calling" };
        },
        providerRequestId: (result) => result.conversationId,
        reconcile: async (attempt) => {
          if (!attempt.providerRequestId) return { status: "not_found" };
          const request = await fetch(`${baseUrl}/v1/convai/conversations/${encodeURIComponent(attempt.providerRequestId)}`, { headers: { "xi-api-key": apiKey } });
          if (request.status === 404) return { status: "not_found" };
          if (!request.ok) return { status: "pending", providerRequestId: attempt.providerRequestId };
          const payload = responseRecord(await request.json());
          const status = pickString(payload, "status") ?? "calling";
          const twilioCallSid = pickString(payload, "callSid", "call_sid", "twilio_call_sid", "twilioCallSid");
          const result: VoiceResponse = twilioCallSid ? { conversationId: attempt.providerRequestId, twilioCallSid, status } : { conversationId: attempt.providerRequestId, status };
          return { status: "succeeded", result };
        },
      });
      await ctx.runMutation(startedReference, { projectId: args.projectId, voiceSessionId: queued.voiceSessionId, callAttemptId: queued.callAttemptId, response });
      return { ...response, voiceSessionId: queued.voiceSessionId };
    } catch (error) {
      await ctx.runMutation(failedReference, {
        projectId: args.projectId,
        voiceSessionId: queued.voiceSessionId,
        callAttemptId: queued.callAttemptId,
        errorCode: error instanceof Error && error.message.includes("HTTP 429") ? "RATE_LIMITED" : "VOICE_CALL_FAILED",
        message: error instanceof Error ? error.message : "Voice call failed",
        retryable: true,
        providerRequestId: "unavailable",
      });
      throw error;
    }
  },
});

export const getCallContext = internalQueryGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<CallContext> => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project) throw new Error(`Project ${args.projectId} not found`);
    if (!project.workflowRunId) throw new Error("Project has no workflow run");
    const business = await ctx.db.get("businesses", project.businessId);
    if (!business) throw new Error("Project business not found");
    if (!business.contactEligible || business.doNotContact) throw new Error("Business is not eligible for contact");
    if (!business.normalizedPhone || !/^\+[1-9]\d{7,14}$/.test(business.normalizedPhone)) throw new Error("Target phone is not valid E.164");
    const attempts = await ctx.db.query("callAttempts").withIndex("by_project_attempt", (query) => query.eq("projectId", args.projectId)).collect();
    const maxAttempts = Math.max(1, Number(process.env.VOICE_CALL_MAX_ATTEMPTS ?? "3"));
    if (attempts.length >= maxAttempts) throw new Error("Voice call attempt policy exhausted");
    return {
      projectId: args.projectId,
      workflowRunId: project.workflowRunId,
      correlationId: project.correlationId,
      business: {
        name: business.name,
        category: business.category,
        targetPhone: business.normalizedPhone,
        address: business.address,
        city: business.city,
        area: business.area,
        timezone: business.timezone,
      },
      attemptNumber: attempts.length + 1,
    };
  },
});

export const queueCall = internalMutationGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project?.workflowRunId) throw new Error("Project or workflow run not found");
    const business = await ctx.db.get("businesses", project.businessId);
    if (!business?.normalizedPhone || !business.contactEligible || business.doNotContact) throw new Error("Business is not eligible for contact");
    const attempts = await ctx.db.query("callAttempts").withIndex("by_project_attempt", (query) => query.eq("projectId", args.projectId)).collect();
    const attemptNumber = attempts.length + 1;
    const idempotencyKey = `${args.projectId}:VOICE_CALL:${attemptNumber}`;
    const existing = await ctx.db.query("callAttempts").withIndex("by_idempotency_key", (query) => query.eq("idempotencyKey", idempotencyKey)).unique();
    if (existing?.voiceSessionId) return { voiceSessionId: existing.voiceSessionId, callAttemptId: existing._id, attemptNumber };
    if (project.state !== "CALL_QUEUED") {
      await transitionProject(ctx as unknown as StateMachineContext, args.projectId as Parameters<typeof transitionProject>[1], "CALL_QUEUED", { workflowRunId: project.workflowRunId as Parameters<typeof transitionProject>[3]["workflowRunId"], correlationId: project.correlationId, stage: "VOICE_CALL" });
    }
    const now = Date.now();
    const voiceSessionId = await ctx.db.insert("voiceSessions", {
      projectId: args.projectId,
      workflowRunId: project.workflowRunId,
      provider: "elevenlabs",
      status: "queued",
      targetPhone: business.normalizedPhone,
      createdAt: now,
      updatedAt: now,
    });
    const callAttemptId = await ctx.db.insert("callAttempts", {
      projectId: args.projectId,
      workflowRunId: project.workflowRunId,
      voiceSessionId,
      attemptNumber,
      idempotencyKey,
      provider: "elevenlabs",
      targetPhone: business.normalizedPhone,
      status: "queued",
      createdAt: now,
    });
    return { voiceSessionId, callAttemptId, attemptNumber };
  },
});

export const recordCallStarted = internalMutationGeneric({
  args: { projectId: v.id("projects"), voiceSessionId: v.id("voiceSessions"), callAttemptId: v.id("callAttempts"), response: v.any() },
  handler: async (ctx, args) => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project?.workflowRunId) throw new Error("Project or workflow run not found");
    const response = args.response as VoiceResponse;
    const now = Date.now();
    await ctx.db.patch("voiceSessions", args.voiceSessionId, { conversationId: response.conversationId, twilioCallSid: response.twilioCallSid, status: response.status, startedAt: now, updatedAt: now });
    await ctx.db.patch("callAttempts", args.callAttemptId, { conversationId: response.conversationId, twilioCallSid: response.twilioCallSid, status: response.status, startedAt: now });
    if (project.state === "CALL_QUEUED") await transitionProject(ctx as unknown as StateMachineContext, args.projectId as Parameters<typeof transitionProject>[1], "CALLING", { workflowRunId: project.workflowRunId as Parameters<typeof transitionProject>[3]["workflowRunId"], correlationId: project.correlationId, stage: "VOICE_CALL" });
    return null;
  },
});

export const recordCallFailure = internalMutationGeneric({
  args: { projectId: v.id("projects"), voiceSessionId: v.id("voiceSessions"), callAttemptId: v.id("callAttempts"), errorCode: v.string(), message: v.string(), retryable: v.boolean(), providerRequestId: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project?.workflowRunId) throw new Error("Project or workflow run not found");
    const attempt = await ctx.db.get("callAttempts", args.callAttemptId);
    const now = Date.now();
    await ctx.db.patch("voiceSessions", args.voiceSessionId, { status: "failed", failedStage: "VOICE_CALL", errorCode: args.errorCode, errorMessage: args.message, retryable: args.retryable, providerRequestId: args.providerRequestId, completedAt: now, updatedAt: now });
    await ctx.db.patch("callAttempts", args.callAttemptId, { status: "failed", failedStage: "VOICE_CALL", errorCode: args.errorCode, errorMessage: args.message, retryable: args.retryable, retryCount: attempt?.attemptNumber ?? 1, maxRetries: Number(process.env.VOICE_CALL_MAX_ATTEMPTS ?? "3"), providerRequestId: args.providerRequestId, completedAt: now });
    if (project.state === "CALL_QUEUED" || project.state === "CALLING") await transitionProject(ctx as unknown as StateMachineContext, args.projectId as Parameters<typeof transitionProject>[1], "CALL_FAILED", { workflowRunId: project.workflowRunId as Parameters<typeof transitionProject>[3]["workflowRunId"], correlationId: project.correlationId, stage: "VOICE_CALL", failedStage: "VOICE_CALL", errorCode: args.errorCode, errorMessage: args.message, retryable: args.retryable, retryCount: attempt?.attemptNumber ?? 1, maxRetries: Number(process.env.VOICE_CALL_MAX_ATTEMPTS ?? "3"), provider: "elevenlabs", providerRequestId: args.providerRequestId, lastAttemptAt: now });
    return null;
  },
});
