// convex/voiceCalls.ts
//
// Stage 4 (Person B), T3.1. Implements the scheduler-hook contract frozen
// in docs/task-plan.md Section 3, row 5:
//
//   Scheduler hook: selectBusiness -> voiceCalls:startCall(projectId)
//
// `startCall` is an `internalAction` taking only `{ projectId }` — Person
// A's `selectBusiness` (Stage 3, T2.3) schedules it with
// `ctx.scheduler.runAfter(0, internal.voiceCalls.startCall, { projectId })`
// once the Lead/Project/WorkflowRun are created and set to PROJECT_CREATED
// -> CALL_QUEUED. Neither side needs to check back with the other — both
// build against this exact function path + argument shape.
//
// PRD docs/project-requirements.md Phase 3 ("Voice Discovery Call"):
//   Convex            -> validates: E.164 number, eligibility, calling
//                         window, attempt policy
//   Convex Action     -> calls ElevenLabs: startCall() with business context
//   ElevenLabs        -> initiates AI conversation agent (Twilio transport)
//   Convex            -> sets state: CALL_QUEUED -> CALLING
//   Convex            -> stores: ElevenLabs conversation ID, Twilio call
//                         SID, voiceSession
//
// Section 11 ("Failure Recovery"): CALL_FAILED -> (Admin: Retry Call) ->
// resume from CALL_QUEUED. Auto-retry happens here first (bounded backoff,
// Section 10); only once attempts are exhausted (or the failure is
// non-retryable — ineligible business, bad phone number, attempt policy
// exceeded) does the project land in MANUAL_INTERVENTION_REQUIRED for an
// admin-triggered retry / "Replay Last Response".

import { v } from "convex/values";
import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  callExternal,
  CallExternalError,
  registerStageAction,
} from "./lib/externalCall";
import { computeBackoffMs, escalateToManualIntervention } from "./lib/stageAttempt";
import { transitionProject, MANUAL_INTERVENTION_REQUIRED } from "./stateMachine";

const STAGE = "VOICE_CALL";
const PROVIDER = "ELEVENLABS" as const;

/** Section 8/11 attempt policy — bounded, then MANUAL_INTERVENTION_REQUIRED. */
const MAX_CALL_ATTEMPTS = Number(env.CALL_MAX_ATTEMPTS ?? "3");

/**
 * Calling-window policy (Section 12: "calling window ... enforced before
 * every call"). Hours are UTC, [start, end). Defaults to unrestricted
 * (0-24) for the hackathon demo line, which runs at whatever time the demo
 * happens — set `CALL_WINDOW_START_HOUR_UTC` / `CALL_WINDOW_END_HOUR_UTC`
 * (Convex env vars) to restrict it for a real deployment.
 */
function isWithinCallingWindow(now: Date): boolean {
  const startHour = Number(env.CALL_WINDOW_START_HOUR_UTC ?? "0");
  const endHour = Number(env.CALL_WINDOW_END_HOUR_UTC ?? "24");
  if (startHour <= 0 && endHour >= 24) {
    return true;
  }
  const hour = now.getUTCHours();
  if (startHour <= endHour) {
    return hour >= startHour && hour < endHour;
  }
  // Window wraps past midnight UTC (e.g. 22 -> 6).
  return hour >= startHour || hour < endHour;
}

const E164_REGEX = /^\+[1-9]\d{7,14}$/;

function isValidE164(phone: string | null | undefined): phone is string {
  return typeof phone === "string" && E164_REGEX.test(phone);
}

interface CallPrecondition {
  ok: boolean;
  targetPhoneE164?: string;
  errorCode?: string;
  message?: string;
  retryable?: boolean;
}

/**
 * Requirement 1: E.164 format, contact eligibility, calling-window policy,
 * and attempt/retry policy, read from `businesses`/`leads`.
 */
function validateCallPreconditions(
  business: Doc<"businesses">,
  previousAttemptCount: number,
): CallPrecondition {
  if (!business.contactEligible) {
    return {
      ok: false,
      errorCode: "NOT_CONTACT_ELIGIBLE",
      message: `Business ${business._id} is not marked contactEligible`,
      retryable: false,
    };
  }
  if (business.doNotContact) {
    return {
      ok: false,
      errorCode: "DO_NOT_CONTACT",
      message: `Business ${business._id} is on the do-not-contact list`,
      retryable: false,
    };
  }
  const targetPhoneE164 = business.phoneE164;
  if (!isValidE164(targetPhoneE164)) {
    return {
      ok: false,
      errorCode: "INVALID_PHONE_FORMAT",
      message:
        `Business ${business._id} has no valid E.164 phone number ` +
        `(phoneE164="${business.phoneE164 ?? "unset"}")`,
      retryable: false,
    };
  }
  if (previousAttemptCount >= MAX_CALL_ATTEMPTS) {
    return {
      ok: false,
      errorCode: "CALL_ATTEMPTS_EXHAUSTED",
      message: `Already made ${previousAttemptCount} call attempt(s) for this project, at the max of ${MAX_CALL_ATTEMPTS}`,
      retryable: false,
    };
  }
  if (!isWithinCallingWindow(new Date())) {
    return {
      ok: false,
      errorCode: "OUTSIDE_CALLING_WINDOW",
      message: "Current time is outside the configured calling window",
      retryable: true,
    };
  }
  return { ok: true, targetPhoneE164 };
}

// ---------------------------------------------------------------------------
// ElevenLabs live() call
// ---------------------------------------------------------------------------

interface ElevenLabsOutboundCallResponse {
  success: boolean;
  message: string;
  conversation_id: string;
  callSid: string;
}

/**
 * Requirement 2: calls ElevenLabs' outbound-call-via-Twilio endpoint with
 * business context so the agent can personalize the conversation
 * (`conversation_initiation_client_data.dynamic_variables` — read by the
 * agent prompt configured in T0.5).
 */
async function startElevenLabsConversation(params: {
  targetPhoneE164: string;
  business: Doc<"businesses">;
  correlationId: string;
}): Promise<{ conversationId: string; twilioCallSid: string }> {
  const apiKey = env.ELEVENLABS_API_KEY;
  const agentId = env.ELEVENLABS_AGENT_ID;
  const agentPhoneNumberId = env.ELEVENLABS_AGENT_PHONE_NUMBER_ID;
  if (!apiKey || !agentId || !agentPhoneNumberId) {
    throw new Error(
      "startElevenLabsConversation: missing ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID / " +
        "ELEVENLABS_AGENT_PHONE_NUMBER_ID Convex environment variables (see Section 16 checklist)",
    );
  }

  const { business, targetPhoneE164, correlationId } = params;

  const response = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      agent_id: agentId,
      agent_phone_number_id: agentPhoneNumberId,
      to_number: targetPhoneE164,
      conversation_initiation_client_data: {
        dynamic_variables: {
          business_name: business.name,
          business_category: business.category,
          business_city: business.city,
          business_area: business.area ?? "",
          business_website: business.website ?? "",
          correlation_id: correlationId,
        },
      },
    }),
  });

  const bodyText = await response.text();
  let parsed: Partial<ElevenLabsOutboundCallResponse> | undefined;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!response.ok || !parsed?.success) {
    const message =
      parsed?.message ?? `ElevenLabs outbound-call request failed with HTTP ${response.status}`;
    // 4xx (bad agent/phone config, invalid number) will never succeed on
    // retry; 5xx / network-level failures are transient.
    const retryable = response.status >= 500 || response.status === 0;
    const error = new Error(message) as Error & { retryable?: boolean };
    error.retryable = retryable;
    throw error;
  }

  return { conversationId: parsed.conversation_id!, twilioCallSid: parsed.callSid! };
}

// ---------------------------------------------------------------------------
// startCall — the frozen scheduler-hook entry point.
// ---------------------------------------------------------------------------

export const startCall = internalAction({
  args: { projectId: v.id("projects") },
  handler: async (ctx: ActionCtx, { projectId }): Promise<{ started: boolean; reason?: string }> => {
    const context = await ctx.runQuery(internal.voiceCalls.loadCallContext, { projectId });
    if (!context) {
      throw new Error(`startCall: project ${projectId} not found`);
    }
    const { project, business, previousAttemptCount } = context;

    if (project.state !== "CALL_QUEUED") {
      // Stale/duplicate schedule (e.g. an admin already resolved this a
      // different way) — nothing to do. Completed stages never re-run
      // (Section 11).
      return {
        started: false,
        reason: `project ${projectId} is not in CALL_QUEUED (currently ${project.state ?? "(unset)"})`,
      };
    }

    const precondition = validateCallPreconditions(business, previousAttemptCount);
    if (!precondition.ok) {
      await ctx.runMutation(internal.voiceCalls.rejectCall, {
        projectId,
        correlationId: project.correlationId,
        errorCode: precondition.errorCode!,
        message: precondition.message!,
        retryable: precondition.retryable ?? false,
        retryCount: previousAttemptCount,
        maxRetries: MAX_CALL_ATTEMPTS,
      });
      return { started: false, reason: precondition.message };
    }
    const targetPhoneE164 = precondition.targetPhoneE164!;

    const callAttemptId: Id<"callAttempts"> = await ctx.runMutation(
      internal.voiceCalls.beginCallAttempt,
      {
        projectId,
        leadId: project.leadId,
        targetPhoneE164,
        attemptNumber: previousAttemptCount + 1,
        correlationId: project.correlationId,
      },
    );

    try {
      const response = await callExternal(ctx, {
        stage: STAGE,
        projectId,
        provider: PROVIDER,
        cacheKey: `attempt-${previousAttemptCount + 1}`,
        maxRetries: MAX_CALL_ATTEMPTS,
        live: () =>
          startElevenLabsConversation({
            targetPhoneE164,
            business,
            correlationId: project.correlationId,
          }),
      });

      await ctx.runMutation(internal.voiceCalls.recordCallStarted, {
        projectId,
        callAttemptId,
        correlationId: project.correlationId,
        elevenLabsConversationId: response.conversationId,
        twilioCallSid: response.twilioCallSid,
        targetPhoneE164,
      });

      return { started: true };
    } catch (err) {
      if (err instanceof CallExternalError) {
        await ctx.runMutation(internal.voiceCalls.handleProviderFailure, {
          projectId,
          callAttemptId,
          correlationId: project.correlationId,
          attemptId: err.attemptId,
          stageError: err.stageError,
          outcome: err.outcome,
        });
        return { started: false, reason: err.stageError.message };
      }
      throw err;
    }
  },
});

// Registers this action so the Admin UI's "Replay Last Response" button
// (convex/lib/externalCall.ts's `replayLastResponse`) can re-invoke it once
// a project sitting in MANUAL_INTERVENTION_REQUIRED at the VOICE_CALL stage
// is replayed.
registerStageAction(STAGE, internal.voiceCalls.startCall);

// ---------------------------------------------------------------------------
// Internal query/mutations backing startCall.
// ---------------------------------------------------------------------------

export const loadCallContext = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) {
      return null;
    }
    const business = await ctx.db.get(project.businessId);
    if (!business) {
      throw new Error(`loadCallContext: business ${project.businessId} not found for project ${projectId}`);
    }
    const previousAttempts = await ctx.db
      .query("callAttempts")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
    return { project, business, previousAttemptCount: previousAttempts.length };
  },
});

export const beginCallAttempt = internalMutation({
  args: {
    projectId: v.id("projects"),
    leadId: v.id("leads"),
    targetPhoneE164: v.string(),
    attemptNumber: v.number(),
    correlationId: v.string(),
  },
  handler: async (ctx, { projectId, leadId, targetPhoneE164, attemptNumber, correlationId }) => {
    const now = Date.now();
    return await ctx.db.insert("callAttempts", {
      projectId,
      leadId,
      attemptNumber,
      targetPhoneE164,
      callingWindowOk: true,
      provider: PROVIDER,
      status: "QUEUED",
      correlationId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const recordCallStarted = internalMutation({
  args: {
    projectId: v.id("projects"),
    callAttemptId: v.id("callAttempts"),
    correlationId: v.string(),
    elevenLabsConversationId: v.string(),
    twilioCallSid: v.string(),
    targetPhoneE164: v.string(),
  },
  handler: async (
    ctx,
    { projectId, callAttemptId, correlationId, elevenLabsConversationId, twilioCallSid, targetPhoneE164 },
  ) => {
    const now = Date.now();

    const voiceSessionId = await ctx.db.insert("voiceSessions", {
      projectId,
      callAttemptId,
      provider: PROVIDER,
      elevenLabsConversationId,
      twilioCallSid,
      targetPhoneE164,
      status: "CALLING",
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(callAttemptId, {
      status: "IN_PROGRESS",
      voiceSessionId,
      updatedAt: now,
    });

    // Requirement 4: CALL_QUEUED -> CALLING via the shared state machine.
    await transitionProject(ctx, projectId, "CALLING", {
      correlationId,
      stage: STAGE,
      provider: PROVIDER,
      providerRequestId: elevenLabsConversationId,
    });

    return voiceSessionId;
  },
});

/**
 * Requirement 5, pre-flight path: a validation failure (ineligible number,
 * bad E.164, attempt policy exceeded, outside calling window) before any
 * provider call was even attempted — no `stageAttempts` row exists yet, so
 * this transitions state directly rather than going through
 * `escalateToManualIntervention` (which needs an existing attempt to read
 * provider/stage metadata from).
 */
export const rejectCall = internalMutation({
  args: {
    projectId: v.id("projects"),
    correlationId: v.string(),
    errorCode: v.string(),
    message: v.string(),
    retryable: v.boolean(),
    retryCount: v.number(),
    maxRetries: v.number(),
  },
  handler: async (
    ctx,
    { projectId, correlationId, errorCode, message, retryable, retryCount, maxRetries },
  ) => {
    // Section 11 Failure Recovery table: CALL_FAILED is always entered
    // first; MANUAL_INTERVENTION_REQUIRED (or an auto-retry back to
    // CALL_QUEUED) only follows from there.
    await transitionProject(ctx, projectId, "CALL_FAILED", {
      correlationId,
      stage: STAGE,
      reason: message,
      failedStage: STAGE,
      errorCode,
      retryable,
      retryCount,
      maxRetries,
      provider: PROVIDER,
      providerRequestId: "PRECHECK",
    });

    if (retryable && retryCount < maxRetries) {
      await transitionProject(ctx, projectId, "CALL_QUEUED", {
        correlationId,
        stage: STAGE,
        eventType: "AUTO_RETRY",
        reason: `Retrying VOICE_CALL after a retryable pre-call validation failure: ${message}`,
      });
      await ctx.scheduler.runAfter(computeBackoffMs(retryCount + 1), internal.voiceCalls.startCall, {
        projectId,
      });
    } else {
      await transitionProject(ctx, projectId, MANUAL_INTERVENTION_REQUIRED, {
        correlationId,
        stage: STAGE,
        reason: message,
        failedStage: STAGE,
        errorCode,
        retryable,
        retryCount,
        maxRetries,
        provider: PROVIDER,
        providerRequestId: "PRECHECK",
      });
    }
  },
});

/**
 * Requirement 5, post-provider-call path: `callExternal` already recorded
 * the `stageAttempts` failure (and the `integrationEvents` audit row) — we
 * still owe the project its `CALL_FAILED` transition (Section 11), then
 * either auto-retry (`CALL_FAILED` -> `CALL_QUEUED` + reschedule with
 * backoff) or escalate to `MANUAL_INTERVENTION_REQUIRED` once
 * `outcome.shouldEscalate` says retries are exhausted / the error is
 * non-retryable.
 */
export const handleProviderFailure = internalMutation({
  args: {
    projectId: v.id("projects"),
    callAttemptId: v.id("callAttempts"),
    correlationId: v.string(),
    attemptId: v.id("stageAttempts"),
    stageError: v.object({
      message: v.string(),
      retryable: v.boolean(),
      code: v.optional(v.string()),
    }),
    outcome: v.object({
      exhausted: v.boolean(),
      retryable: v.boolean(),
      shouldEscalate: v.boolean(),
      backoffMs: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { projectId, callAttemptId, correlationId, attemptId, stageError, outcome }) => {
    const attempt = await ctx.db.get(attemptId);
    const retryCount = attempt?.attemptCount ?? 1;
    const maxRetries = MAX_CALL_ATTEMPTS;
    const providerRequestId = attempt?.providerRequestId ?? attemptId;

    await ctx.db.patch(callAttemptId, {
      status: "FAILED",
      failedStage: STAGE,
      errorCode: stageError.code ?? stageError.message,
      retryable: stageError.retryable,
      retryCount,
      maxRetries,
      providerRequestId: attempt?.providerRequestId,
      updatedAt: Date.now(),
    });

    await transitionProject(ctx, projectId, "CALL_FAILED", {
      correlationId,
      stage: STAGE,
      reason: stageError.message,
      failedStage: STAGE,
      errorCode: stageError.code ?? stageError.message,
      retryable: stageError.retryable,
      retryCount,
      maxRetries,
      provider: PROVIDER,
      providerRequestId,
    });

    if (outcome.shouldEscalate) {
      await escalateToManualIntervention(ctx, attemptId, {
        correlationId,
        error: stageError,
        retryCount,
        maxRetries,
      });
    } else {
      await transitionProject(ctx, projectId, "CALL_QUEUED", {
        correlationId,
        stage: STAGE,
        eventType: "AUTO_RETRY",
        reason: "Auto-retrying VOICE_CALL after a retryable ElevenLabs failure",
      });
      await ctx.scheduler.runAfter(outcome.backoffMs ?? 0, internal.voiceCalls.startCall, {
        projectId,
      });
    }
  },
});
