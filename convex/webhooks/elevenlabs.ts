// convex/webhooks/elevenlabs.ts
//
// Stage 4 (Person B), T3.2. HTTP Action wired into convex/http.ts at
// POST /webhooks/elevenlabs — "On call end -> ElevenLabs fires webhook ->
// Convex HTTP Action receives it" (PRD Section 4.4 / Phase 4).
//
// After deploying, the live URL is:
//   https://<deployment>.convex.site/webhooks/elevenlabs
// (Convex serves HTTP Actions off the `.convex.site` domain, not
// `.convex.cloud`.) Paste that into the ElevenLabs agent's Webhooks /
// post-call settings in T3.0b.

import { httpAction, internalMutation, env } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { transitionProject } from "../stateMachine";

const PROVIDER = "ELEVENLABS" as const;
const CALL_STAGE = "VOICE_CALL";
const TRANSCRIPT_STAGE = "CALL_TRANSCRIPT";

// ---------------------------------------------------------------------------
// Requirement 1: signature verification.
//
// ElevenLabs signs webhooks with `ElevenLabs-Signature: t=<unix_ts>,v0=<hex>`
// over the payload `${timestamp}.${rawBody}`, HMAC-SHA256, hex-encoded
// (https://elevenlabs.io/docs/eleven-api/resources/webhooks). There is no
// ElevenLabs SDK dependency in this project, so this is a small
// dependency-free reimplementation using the platform's Web Crypto API
// (available in Convex's HTTP Action runtime).
// ---------------------------------------------------------------------------

const SIGNATURE_TOLERANCE_MS = 30 * 60 * 1000; // 30 minutes, matches ElevenLabs' own SDKs

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time comparison of two equal-length hex strings. */
function hexStringsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

interface SignatureVerification {
  valid: boolean;
  reason?: string;
}

async function verifyElevenLabsSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<SignatureVerification> {
  if (!signatureHeader) {
    return { valid: false, reason: "missing ElevenLabs-Signature header" };
  }

  const elements = signatureHeader.split(",");
  const timestamp = elements.find((e) => e.startsWith("t="))?.slice(2);
  const signature = elements.find((e) => e.startsWith("v0="))?.slice(3);
  if (!timestamp || !signature) {
    return { valid: false, reason: 'no signature found with expected scheme "v0"' };
  }

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > SIGNATURE_TOLERANCE_MS) {
    return { valid: false, reason: "timestamp outside tolerance window" };
  }

  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  if (!hexStringsEqual(expected, signature)) {
    return { valid: false, reason: "signature mismatch" };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// HTTP Action
// ---------------------------------------------------------------------------

export const elevenLabsWebhook = httpAction(async (ctx, request) => {
  // Requirement 1 needs the exact raw bytes that were signed — read as text
  // before any JSON parsing.
  const rawBody = await request.text();

  const secret = env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) {
    // Per docs/task-plan.md T0.9: fail loudly (503) rather than silently
    // accepting unverified webhooks — this is what makes a missing secret
    // visible instead of silently stalling every project at CALLING.
    return new Response("ELEVENLABS_WEBHOOK_SECRET is not configured", { status: 503 });
  }

  const signatureHeader = request.headers.get("elevenlabs-signature");
  const verification = await verifyElevenLabsSignature(rawBody, signatureHeader, secret);
  if (!verification.valid) {
    return new Response(`Invalid webhook signature: ${verification.reason}`, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON payload", { status: 400 });
  }

  const eventType = getStringField(payload, "type") ?? "unknown";
  const data = getObjectField(payload, "data");
  const conversationId = data ? getStringField(data, "conversation_id") : undefined;

  if (!conversationId) {
    return new Response("Missing data.conversation_id", { status: 400 });
  }

  if (eventType !== "post_call_transcription") {
    // Other event types (post_call_audio, call_initiation_failure,
    // workspace_event, ...) aren't handled by this stage yet — ack with
    // 200 so ElevenLabs doesn't retry/disable the webhook, but don't run
    // any project-side processing for them.
    return new Response("ok (event type not processed)", { status: 200 });
  }

  const result = await ctx.runMutation(internal.webhooks.elevenlabs.processTranscriptWebhook, {
    conversationId,
    eventType,
    // `payload`/`data` are stored as opaque JSON (Section 12 — transcript
    // and customer text are untrusted input; never interpolated into
    // prompts or code, just persisted as data for later, separately
    // validated, processing).
    payload,
  });

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

function getObjectField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "object" && field !== null ? (field as Record<string, unknown>) : undefined;
}

function getStringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

// ---------------------------------------------------------------------------
// Requirements 2-6: dedup, resolve, store, transition, schedule.
//
// A separate internal mutation (rather than inline in the HTTP Action)
// because HTTP Action handlers don't get a `ctx.db` — same reason
// convex/lib/externalCall.ts's `callExternal` calls out to internal
// mutations/queries.
// ---------------------------------------------------------------------------

type ProcessResult =
  | { status: "already_processed"; projectId: unknown }
  | { status: "voice_session_not_found" }
  | { status: "project_not_found" }
  | { status: "processed"; projectId: unknown };

export const processTranscriptWebhook = internalMutation({
  args: {
    conversationId: v.string(),
    eventType: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, { conversationId, eventType, payload }): Promise<ProcessResult> => {
    // Requirement 2: dedupe by (provider, providerEventId=conversationId)
    // (Section 10 — "Every inbound webhook -> store in webhookEvents by
    // provider event ID before processing").
    const dedupeKey = `${PROVIDER}:${conversationId}`;
    const existing = await ctx.db
      .query("webhookEvents")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
      .unique();

    if (existing?.processed) {
      return { status: "already_processed", projectId: existing.projectId };
    }

    const webhookEventId =
      existing?._id ??
      (await ctx.db.insert("webhookEvents", {
        provider: PROVIDER,
        providerEventId: conversationId,
        dedupeKey,
        eventType,
        signatureValid: true,
        payload,
        processed: false,
        receivedAt: Date.now(),
      }));

    // Requirement 3: conversation ID -> voiceSessions -> project.
    const voiceSession = await ctx.db
      .query("voiceSessions")
      .withIndex("by_elevenLabsConversationId", (q) => q.eq("elevenLabsConversationId", conversationId))
      .unique();

    if (!voiceSession) {
      // No matching voiceSessions row yet — most likely a race with
      // startCall's own write (or a webhook from outside this project's
      // pipeline). Leave `processed: false` so a legitimate ElevenLabs
      // retry can still resolve it once the row lands, rather than
      // dropping the event.
      await ctx.db.patch(webhookEventId, {
        processingError: `no voiceSessions row found for conversationId ${conversationId}`,
      });
      return { status: "voice_session_not_found" };
    }

    const project = await ctx.db.get(voiceSession.projectId);
    if (!project) {
      await ctx.db.patch(webhookEventId, {
        processingError: `project ${voiceSession.projectId} not found`,
      });
      return { status: "project_not_found" };
    }

    await ctx.db.patch(webhookEventId, { projectId: project._id });

    // Requirement 4: store the transcript payload. Treated as opaque data
    // throughout (Section 12) — copied verbatim into structured fields,
    // never interpolated into a prompt/code string.
    const data = getObjectField(payload, "data");
    const turns = extractTranscriptTurns(data);
    const rawTranscript = JSON.stringify(data?.transcript ?? payload);

    await ctx.db.insert("transcripts", {
      projectId: project._id,
      voiceSessionId: voiceSession._id,
      elevenLabsConversationId: conversationId,
      rawTranscript,
      turns,
      source: "ELEVENLABS_WEBHOOK",
      receivedAt: Date.now(),
      createdAt: Date.now(),
    });

    await ctx.db.patch(voiceSession._id, {
      status: "COMPLETED",
      endedAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Requirement 5: CALL_COMPLETED -> TRANSCRIPT_RECEIVED. Nothing else in
    // this pipeline yet transitions CALLING -> CALL_COMPLETED (there's no
    // separate call-status webhook/poll) — the arrival of the transcript
    // itself is the completion signal, so pass through that edge first if
    // needed, then TRANSCRIPT_RECEIVED. Guarded by current state so a
    // duplicate/out-of-order delivery can't crash on an illegal transition.
    if (project.state === "CALLING") {
      await transitionProject(ctx, project._id, "CALL_COMPLETED", {
        correlationId: project.correlationId,
        stage: CALL_STAGE,
        provider: PROVIDER,
        providerRequestId: conversationId,
      });
    }

    const projectNow = await ctx.db.get(project._id);
    if (projectNow?.state === "CALL_COMPLETED") {
      await transitionProject(ctx, project._id, "TRANSCRIPT_RECEIVED", {
        correlationId: project.correlationId,
        stage: TRANSCRIPT_STAGE,
        provider: PROVIDER,
        providerRequestId: conversationId,
      });

      // Requirement 6: schedule requirement extraction (T3.3).
      await ctx.scheduler.runAfter(0, internal.requirements.extractRequirements, {
        projectId: project._id,
      });
    }

    await ctx.db.patch(webhookEventId, { processed: true, processedAt: Date.now() });

    return { status: "processed", projectId: project._id };
  },
});

/**
 * Maps ElevenLabs' `data.transcript[]` turns (`{ role: "agent" | "user",
 * message, time_in_call_secs, ... }`) onto the `transcripts.turns` schema
 * shape (`{ speaker: "agent" | "customer", text, startedAtMs }`). Copies
 * text through as opaque data only — never parsed for control characters,
 * never used to build a prompt/code string here.
 */
function extractTranscriptTurns(
  data: Record<string, unknown> | undefined,
): { speaker: "agent" | "customer"; text: string; startedAtMs?: number }[] | undefined {
  const rawTurns = data?.transcript;
  if (!Array.isArray(rawTurns)) {
    return undefined;
  }
  const turns: { speaker: "agent" | "customer"; text: string; startedAtMs?: number }[] = [];
  for (const turn of rawTurns) {
    if (typeof turn !== "object" || turn === null) {
      continue;
    }
    const role = (turn as Record<string, unknown>).role;
    const message = (turn as Record<string, unknown>).message;
    const timeInCallSecs = (turn as Record<string, unknown>).time_in_call_secs;
    if (typeof message !== "string") {
      continue;
    }
    turns.push({
      speaker: role === "agent" ? "agent" : "customer",
      text: message,
      startedAtMs: typeof timeInCallSecs === "number" ? timeInCallSecs * 1000 : undefined,
    });
  }
  return turns;
}
