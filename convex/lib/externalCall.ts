// convex/lib/externalCall.ts
//
// Shared Contract #4 (see docs/task-plan.md Section 3).
//
// PRD Section 9 — Demo Resilience: Replay Fallback. Every external
// integration built by anyone — Context.dev search, ElevenLabs call
// result, OpenAI extraction, Devin build result, GitHub Actions result,
// Firebase deploy result, Twilio delivery status — MUST be wrapped in this
// rather than each stage writing its own live/replay logic:
//
//   callExternal(ctx, { stage, projectId, live, cacheKey, provider? })
//     -- called from inside an `action`. Live mode calls `live()` and
//        stores the result as the stage's "last successful response".
//        Replay mode (a global env flag, or this project's own
//        `externalCallReplayFlags` row) skips `live()` and returns that
//        last stored response instead. Either way `callExternal` just
//        returns a value — the caller's own subsequent code (further
//        writes, `transitionProject` calls) runs unchanged, so a replayed
//        response is never allowed to skip a state transition a live one
//        would have caused (Section 9, "Fallback does not skip state
//        transitions").
//
//   replayLastResponse(projectId, stage)   -- public mutation
//     -- what the Admin UI's "Replay Last Response" button (Stage 8's
//        T7.3) calls directly for a project sitting in
//        MANUAL_INTERVENTION_REQUIRED. Verifies a cached response exists,
//        moves the project through the SAME `transitionProject` resume
//        edge an automatic retry would use, flips this project into replay
//        mode, and (if the owning stage has registered itself — see
//        `registerStageAction` below) re-schedules that stage's own action
//        so it re-enters its normal `callExternal(...)` call and gets the
//        cached value back, running its usual downstream processing.
//
//   registerStageAction(stage, actionRef)
//     -- called once, at import time, by each stage's own module (e.g.
//        `registerStageAction("VOICE_CALL", internal.voiceCalls.startCall)`
//        in convex/voiceCalls.ts) so `replayLastResponse` above can find
//        and re-run it. Optional: without a registered handler,
//        `replayLastResponse` still validates + transitions + flips the
//        replay flag, it just can't kick the action itself.
//
// Builds on the other two Stage 1 contracts already in this repo:
//   - convex/lib/stageAttempt.ts (contract #3): `stageAttempts.result` on a
//     COMPLETED attempt already IS the "last successful response" per
//     (projectId, stage) — this module doesn't need a second cache table.
//   - convex/stateMachine.ts (contract #2): `transitionProject` is what
//     "does not skip state transitions" actually means here.

import { v } from "convex/values";
import {
  env,
  internalMutation,
  internalQuery,
  mutation,
  type ActionCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { FunctionReference } from "convex/server";
import {
  beginStageAttempt,
  completeStageAttempt,
  failStageAttempt,
  escalateToManualIntervention,
  DEFAULT_MAX_RETRIES,
  type StageError,
} from "./stageAttempt";
import {
  transitionProject,
  MANUAL_INTERVENTION_REQUIRED,
  type ProjectState,
} from "../stateMachine";

// ---------------------------------------------------------------------------
// Providers (Section 9's list)
// ---------------------------------------------------------------------------

export type ProviderName =
  | "CONTEXTDEV"
  | "ELEVENLABS"
  | "OPENAI"
  | "DEVIN"
  | "GITHUB"
  | "FIREBASE"
  | "TWILIO";

const providerNameValidator = v.union(
  v.literal("CONTEXTDEV"),
  v.literal("ELEVENLABS"),
  v.literal("OPENAI"),
  v.literal("DEVIN"),
  v.literal("GITHUB"),
  v.literal("FIREBASE"),
  v.literal("TWILIO"),
);

const stageErrorArgValidator = v.object({
  message: v.string(),
  retryable: v.boolean(),
  code: v.optional(v.string()),
});

/**
 * The project-level state each known pipeline stage resumes into once a
 * (replayed or freshly live) response is available — mirrors
 * `TRANSITIONS[MANUAL_INTERVENTION_REQUIRED]` in convex/stateMachine.ts
 * exactly, since that's the same edge an admin-triggered replay uses.
 * Extend this alongside that list if a new resumable stage is added.
 * `BUSINESS_SEARCH` is intentionally absent — Context.dev search happens
 * before a Lead/Project exists (PRD Phase 1), so there's no project state
 * transition to replay for it.
 */
const STAGE_RESUME_STATE: Record<string, ProjectState> = {
  VOICE_CALL: "CALL_QUEUED",
  REQUIREMENTS_EXTRACTION: "REQUIREMENTS_PROCESSING",
  DOCUMENT_GENERATION: "DOCUMENTS_GENERATING",
  REPOSITORY_PREPARATION: "REPOSITORY_PREPARING",
  DEVIN_BUILD: "BUILD_QUEUED",
  BUILD_VALIDATION: "BUILD_QUEUED",
  FIREBASE_DEPLOY: "DEPLOYMENT_QUEUED",
  WHATSAPP_DELIVERY: "NOTIFICATION_PENDING",
  REVISION_BUILD: "REVISION_QUEUED",
};

// ---------------------------------------------------------------------------
// Stage action registry
// ---------------------------------------------------------------------------

type StageActionRef = FunctionReference<
  "action" | "mutation",
  "public" | "internal",
  { projectId: Id<"projects"> },
  unknown
>;

const stageActions = new Map<string, StageActionRef>();

/**
 * Call once, at module import time, from the Convex file that owns a
 * pipeline stage (the one that calls `callExternal` with this exact
 * `stage` string) — e.g.:
 *
 *   // convex/voiceCalls.ts
 *   registerStageAction("VOICE_CALL", internal.voiceCalls.startCall);
 *
 * so the Admin UI's "Replay Last Response" button can re-invoke the right
 * action after `replayLastResponse` flips this project into replay mode.
 */
export function registerStageAction(stage: string, actionRef: StageActionRef): void {
  stageActions.set(stage, actionRef);
}

/** Test/inspection helper — not used by callExternal itself. */
export function getRegisteredStageAction(stage: string): StageActionRef | undefined {
  return stageActions.get(stage);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Throw this from inside a `live()` callback to mark the failure as
 * non-retryable (e.g. a 4xx / validation rejection from the provider) so
 * `callExternal` escalates straight to MANUAL_INTERVENTION_REQUIRED instead
 * of burning retries on something that will never succeed unattended.
 */
export class NonRetryableError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "NonRetryableError";
    this.code = code;
  }
}

function toStageError(rawError: unknown): StageError {
  if (rawError instanceof NonRetryableError) {
    return { message: rawError.message, retryable: false, code: rawError.code };
  }
  if (rawError instanceof Error) {
    return { message: rawError.message, retryable: true };
  }
  return { message: String(rawError), retryable: true };
}

// ---------------------------------------------------------------------------
// callExternal — the frozen shared-contract signature.
// ---------------------------------------------------------------------------

export interface CallExternalParams<T> {
  /** Pipeline stage name (Section 10 idempotency key component) — e.g. "VOICE_CALL", "DEVIN_BUILD". Must match a key in STAGE_RESUME_STATE if this stage is meant to be admin-replayable. */
  stage: string;
  projectId: Id<"projects">;
  live: () => Promise<T>;
  /** Optional free-form label recorded on the attempt for audit/debugging (e.g. the search query for a Context.dev call). NOT part of the cache key — Section 9 keys the "last successful response" by (projectId, stage) only, so a second call with a different cacheKey for the same stage still overwrites the same cache slot. */
  cacheKey?: string;
  /** Which third-party provider this call is against. Required to write an `integrationEvents` audit row; omitting it just skips that row — the stageAttempts bookkeeping (and thus the replay cache) still happens either way. */
  provider?: ProviderName;
  /** Defaults to 1. Bump only to start a brand-new idempotency-key generation for this stage (e.g. inputs upstream changed) rather than resuming/retrying the current one. */
  version?: number;
  maxRetries?: number;
  leaseMs?: number;
}

/**
 * Shared Contract #4. See the module doc comment above for the full
 * behavior. Must be called from inside an `action` (or anything with an
 * `ActionCtx`) since it needs to run a real network call in `live()`.
 */
export async function callExternal<T>(
  ctx: ActionCtx,
  params: CallExternalParams<T>,
): Promise<T> {
  const { stage, projectId, live, cacheKey, provider } = params;
  const version = params.version ?? 1;

  const replaying: boolean = await ctx.runQuery(internal.lib.externalCall.isReplayMode, {
    projectId,
  });

  if (replaying) {
    const cached = await ctx.runQuery(internal.lib.externalCall.getLastSuccessfulResponse, {
      projectId,
      stage,
    });
    if (cached === undefined) {
      throw new Error(
        `callExternal: replay mode is active for project ${projectId} at stage "${stage}", ` +
          `but no successful response has ever been stored for it — cannot fall back to a ` +
          `value that doesn't exist. Run this stage live at least once first.`,
      );
    }
    await ctx.runMutation(internal.lib.externalCall.recordIntegrationEvent, {
      projectId,
      stage,
      provider,
      eventType: `${stage}_REPLAY`,
      success: true,
      isReplay: true,
      responsePayload: cached,
    });
    return cached as T;
  }

  const begin = await ctx.runMutation(internal.lib.externalCall.beginAttempt, {
    projectId,
    stage,
    version,
    cacheKey,
    leaseMs: params.leaseMs,
  });

  if (begin.alreadyCompleted) {
    // A previous live call for this exact (projectId, stage, version)
    // already succeeded — don't call the provider again.
    return begin.cachedResult as T;
  }

  try {
    const result = await live();
    await ctx.runMutation(internal.lib.externalCall.completeAttempt, {
      attemptId: begin.attemptId,
      projectId,
      stage,
      provider,
      result,
    });
    return result;
  } catch (rawError) {
    await ctx.runMutation(internal.lib.externalCall.failAttempt, {
      attemptId: begin.attemptId,
      projectId,
      stage,
      provider,
      error: toStageError(rawError),
      maxRetries: params.maxRetries,
    });
    // Bookkeeping (retry/backoff decision + manual-intervention escalation)
    // already happened server-side above; the caller still sees the
    // original error so its own action can decide whether to schedule a
    // retry with `ctx.scheduler.runAfter(backoffMs, ...)`.
    throw rawError;
  }
}

// ---------------------------------------------------------------------------
// Internal Convex functions backing callExternal.
//
// `callExternal` runs from an `action`, which has no direct `ctx.db` — so
// every read/write it needs is one of these internal query/mutations,
// called via `ctx.runQuery` / `ctx.runMutation`.
// ---------------------------------------------------------------------------

export const isReplayMode = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    // Global flag (Section 9: "a project-level or global flag") — set via
    // `npx convex env set EXTERNAL_CALL_GLOBAL_REPLAY true`.
    if (env.EXTERNAL_CALL_GLOBAL_REPLAY === "true") {
      return true;
    }
    const flag = await ctx.db
      .query("externalCallReplayFlags")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .unique();
    return flag?.enabled ?? false;
  },
});

export const getLastSuccessfulResponse = internalQuery({
  args: { projectId: v.id("projects"), stage: v.string() },
  handler: async (ctx, { projectId, stage }) => {
    const attempts = await ctx.db
      .query("stageAttempts")
      .withIndex("by_projectId_and_stage", (q) => q.eq("projectId", projectId).eq("stage", stage))
      .collect();
    const completed = attempts.filter((a) => a.status === "COMPLETED");
    if (completed.length === 0) {
      return undefined;
    }
    completed.sort((a, b) => (b.completedAt ?? b.startedAt) - (a.completedAt ?? a.startedAt));
    return completed[0].result;
  },
});

export const beginAttempt = internalMutation({
  args: {
    projectId: v.id("projects"),
    stage: v.string(),
    version: v.number(),
    cacheKey: v.optional(v.string()),
    leaseMs: v.optional(v.number()),
  },
  handler: async (ctx, { projectId, stage, version, cacheKey, leaseMs }) => {
    const begin = await beginStageAttempt(ctx, projectId, stage, version, { leaseMs });
    if (cacheKey !== undefined) {
      await ctx.db.patch(begin.attemptId, { requestPayload: { cacheKey } });
    }
    return {
      attemptId: begin.attemptId,
      alreadyCompleted: begin.alreadyCompleted,
      cachedResult: begin.cachedResult,
    };
  },
});

export const completeAttempt = internalMutation({
  args: {
    attemptId: v.id("stageAttempts"),
    projectId: v.id("projects"),
    stage: v.string(),
    provider: v.optional(providerNameValidator),
    result: v.any(),
  },
  handler: async (ctx, { attemptId, projectId, stage, provider, result }) => {
    await completeStageAttempt(ctx, attemptId, result);
    if (provider) {
      await ctx.db.insert("integrationEvents", {
        projectId,
        stageAttemptId: attemptId,
        provider,
        direction: "outbound",
        eventType: `${stage}_LIVE_SUCCESS`,
        responsePayload: result,
        success: true,
        isReplay: false,
        createdAt: Date.now(),
      });
    }
  },
});

export const failAttempt = internalMutation({
  args: {
    attemptId: v.id("stageAttempts"),
    projectId: v.id("projects"),
    stage: v.string(),
    provider: v.optional(providerNameValidator),
    error: stageErrorArgValidator,
    maxRetries: v.optional(v.number()),
  },
  handler: async (ctx, { attemptId, projectId, stage, provider, error, maxRetries }) => {
    const outcome = await failStageAttempt(ctx, attemptId, error, { maxRetries });

    if (provider) {
      await ctx.db.insert("integrationEvents", {
        projectId,
        stageAttemptId: attemptId,
        provider,
        direction: "outbound",
        eventType: `${stage}_LIVE_FAILURE`,
        success: false,
        errorMessage: error.message,
        isReplay: false,
        createdAt: Date.now(),
      });
    }

    if (outcome.shouldEscalate) {
      const project = await ctx.db.get(projectId);
      if (!project) {
        throw new Error(`failAttempt: project ${projectId} not found`);
      }
      const attempt = await ctx.db.get(attemptId);
      await escalateToManualIntervention(ctx, attemptId, {
        correlationId: project.correlationId,
        error,
        retryCount: attempt?.attemptCount ?? 0,
        maxRetries: maxRetries ?? DEFAULT_MAX_RETRIES,
      });
    }

    return outcome;
  },
});

export const recordIntegrationEvent = internalMutation({
  args: {
    projectId: v.id("projects"),
    stage: v.string(),
    provider: v.optional(providerNameValidator),
    eventType: v.string(),
    success: v.boolean(),
    isReplay: v.boolean(),
    responsePayload: v.optional(v.any()),
  },
  handler: async (ctx, { projectId, provider, eventType, success, isReplay, responsePayload }) => {
    if (!provider) {
      // integrationEvents.provider is required by convex/schema.ts — skip
      // the audit row when the caller didn't identify one. stageAttempts
      // bookkeeping (and thus the replay cache itself) is unaffected.
      return;
    }
    await ctx.db.insert("integrationEvents", {
      projectId,
      provider,
      direction: "outbound",
      eventType,
      success,
      isReplay,
      responsePayload,
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// replayLastResponse — public mutation the Admin UI's "Replay Last
// Response" button (Stage 8's T7.3) calls directly.
// ---------------------------------------------------------------------------

export const replayLastResponse = mutation({
  args: { projectId: v.id("projects"), stage: v.string() },
  handler: async (ctx, { projectId, stage }) => {
    const project = await ctx.db.get(projectId);
    if (!project) {
      throw new Error(`replayLastResponse: project ${projectId} not found`);
    }
    if (project.state !== MANUAL_INTERVENTION_REQUIRED) {
      throw new Error(
        `replayLastResponse: project ${projectId} is not in MANUAL_INTERVENTION_REQUIRED ` +
          `(currently ${project.state ?? "(unset)"}) — nothing to replay it into`,
      );
    }

    const attempts = await ctx.db
      .query("stageAttempts")
      .withIndex("by_projectId_and_stage", (q) => q.eq("projectId", projectId).eq("stage", stage))
      .collect();
    const completed = attempts.filter((a) => a.status === "COMPLETED");
    if (completed.length === 0) {
      throw new Error(
        `replayLastResponse: no successful response has ever been stored for project ` +
          `${projectId} at stage "${stage}" — nothing to replay`,
      );
    }
    completed.sort((a, b) => (b.completedAt ?? b.startedAt) - (a.completedAt ?? a.startedAt));
    const cachedResult = completed[0].result;

    const resumeState = STAGE_RESUME_STATE[stage];
    if (!resumeState) {
      throw new Error(
        `replayLastResponse: stage "${stage}" has no registered resume state — add it to ` +
          `STAGE_RESUME_STATE in convex/lib/externalCall.ts (and to ` +
          `TRANSITIONS[MANUAL_INTERVENTION_REQUIRED] in convex/stateMachine.ts if missing there too)`,
      );
    }

    // Section 9: "Fallback does not skip state transitions" — go through
    // exactly the same transitionProject edge an automatic retry would use.
    await transitionProject(ctx, projectId, resumeState, {
      correlationId: project.correlationId,
      stage,
      eventType: "REPLAY_LAST_RESPONSE",
      reason: "Admin-triggered replay of last successful response",
    });

    // Flip this project into replay mode so the resumed stage's own
    // callExternal(...) call serves the cached response instead of calling
    // the live provider again.
    const existingFlag = await ctx.db
      .query("externalCallReplayFlags")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .unique();
    if (existingFlag) {
      await ctx.db.patch(existingFlag._id, { enabled: true, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("externalCallReplayFlags", {
        projectId,
        enabled: true,
        updatedAt: Date.now(),
      });
    }

    const actionRef = stageActions.get(stage);
    if (actionRef) {
      await ctx.scheduler.runAfter(0, actionRef, { projectId });
    }

    return {
      resumedState: resumeState,
      replayedResult: cachedResult,
      handlerScheduled: Boolean(actionRef),
    };
  },
});

/**
 * Admin toggle for the project-level replay flag directly (e.g. to turn it
 * back off after a demo, without waiting for the next MANUAL_INTERVENTION
 * cycle). `replayLastResponse` above sets this to `true` automatically.
 */
export const setProjectReplayMode = mutation({
  args: { projectId: v.id("projects"), enabled: v.boolean() },
  handler: async (ctx, { projectId, enabled }) => {
    const existing = await ctx.db
      .query("externalCallReplayFlags")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { enabled, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("externalCallReplayFlags", { projectId, enabled, updatedAt: Date.now() });
    }
  },
});
