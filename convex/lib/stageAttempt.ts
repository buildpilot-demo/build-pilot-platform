// convex/lib/stageAttempt.ts
//
// Shared Contract #3 (see docs/task-plan.md Section 3).
//
// Section 10 — Idempotency & Durability Rules. Every external-call action,
// across every stage, must use this module rather than reimplementing
// retry/locking logic locally:
//
//   beginStageAttempt(ctx, projectId, stage, version, opts?)
//   recordProviderRequest(ctx, attemptId, provider, providerRequestId)
//   completeStageAttempt(ctx, attemptId, result)
//   failStageAttempt(ctx, attemptId, error, opts?)
//   reconcileStaleAttempt(ctx, idempotencyKey)
//   escalateToManualIntervention(ctx, attemptId, info)
//   computeBackoffMs(attemptNumber)
//
// Published shapes are kept stable — every stage's external-call action
// (Context.dev, ElevenLabs, OpenAI, Devin, GitHub Actions, Firebase,
// Twilio) depends on this signature.
//
// This module builds directly on convex/stateMachine.ts's `transitionProject`
// (Shared Contract #2) for the one path that changes project state — moving
// a project to MANUAL_INTERVENTION_REQUIRED once retries are exhausted or an
// error is non-retryable. It never patches `projects`/`workflowRuns` state
// itself.

import type { Infer } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { providerName } from "../schema";
import { MANUAL_INTERVENTION_REQUIRED, transitionProject } from "../stateMachine";

export const DEFAULT_LEASE_MS = 2 * 60 * 1000; // 2 minutes
export const DEFAULT_MAX_RETRIES = 3;
export const BASE_BACKOFF_MS = 1000;
export const MAX_BACKOFF_MS = 30_000;

/** External integration identifiers — reuses schema.ts's `providerName` validator as the source of truth (see its comment there). */
export type ProviderName = Infer<typeof providerName>;

export interface StageError {
  message: string;
  retryable: boolean;
  code?: string;
}

function idempotencyKeyFor(projectId: Id<"projects">, stage: string, version: number): string {
  // Section 10: deterministic idempotency key "projectId:stage:version".
  return `${projectId}:${stage}:${version}`;
}

/**
 * Bounded exponential backoff + jitter (Section 10, "Retry only retryable
 * errors with bounded exponential backoff + jitter"). `attemptNumber` is
 * 1-based (the attempt that just failed). Uses the "equal jitter" shape
 * (half the exponential cap, plus up to another half at random) so retries
 * are never scheduled at exactly zero delay.
 */
export function computeBackoffMs(attemptNumber: number): number {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attemptNumber - 1));
  const jitter = Math.random() * exp * 0.5;
  return Math.round(exp / 2 + jitter);
}

async function findByIdempotencyKey(ctx: MutationCtx, idempotencyKey: string) {
  return await ctx.db
    .query("stageAttempts")
    .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idempotencyKey))
    .unique();
}

/** Snapshot of a previous attempt whose lease timed out without completing. */
export interface StaleAttemptInfo {
  attemptId: Id<"stageAttempts">;
  provider?: ProviderName;
  providerRequestId?: string;
  attemptCount: number;
}

/**
 * Reconcile a timed-out previous attempt on the same idempotency key before
 * a new resource is created against the provider (Section 10, "Reconcile
 * timed-out provider requests before creating new resource"). Safe to call
 * even if there is no stale attempt. Returns the stale attempt's
 * provider/providerRequestId (if any were recorded via
 * `recordProviderRequest` before the lease expired) so the caller can check
 * with the provider whether that request already produced a resource
 * *before* issuing a brand-new create call.
 */
export async function reconcileStaleAttempt(
  ctx: MutationCtx,
  idempotencyKey: string,
): Promise<StaleAttemptInfo | null> {
  const existing = await findByIdempotencyKey(ctx, idempotencyKey);
  if (
    existing &&
    existing.status === "IN_PROGRESS" &&
    existing.leaseExpiresAt !== undefined &&
    existing.leaseExpiresAt < Date.now()
  ) {
    const stale: StaleAttemptInfo = {
      attemptId: existing._id,
      provider: existing.provider,
      providerRequestId: existing.providerRequestId,
      attemptCount: existing.attemptCount,
    };
    await ctx.db.patch(existing._id, {
      status: "FAILED",
      error: {
        message: "Stage attempt lease expired before completion (timed-out provider request)",
        retryable: true,
        code: "LEASE_TIMEOUT",
      },
      completedAt: Date.now(),
      leaseExpiresAt: undefined,
    });
    return stale;
  }
  return null;
}

export interface BeginStageAttemptResult {
  attemptId: Id<"stageAttempts">;
  idempotencyKey: string;
  /** True if a previously COMPLETED attempt was found and should be reused as-is (no new provider call needed). */
  alreadyCompleted: boolean;
  cachedResult?: unknown;
  attemptNumber: number;
  /**
   * Set when this attempt reconciles a previous attempt whose lease timed
   * out before completing. If it carries a `providerRequestId`, the caller
   * MUST check with the provider for an existing resource under that id
   * before creating a new one (Section 10, "Reconcile timed-out provider
   * requests before creating new resource").
   */
  reconciledFrom?: StaleAttemptInfo;
}

/**
 * Begin (or resume) a stage attempt. Computes the deterministic idempotency
 * key, reconciles any timed-out previous attempt, then either:
 * - returns the cached result if an attempt with this key already
 *   COMPLETED (so callers don't double-call the provider), or
 * - rejects if another attempt currently holds an unexpired lease, or
 * - acquires the lease (inserting or reusing the stageAttempts row) and
 *   returns the new attemptId for the caller to complete/fail.
 */
export async function beginStageAttempt(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  stage: string,
  version: number,
  opts?: { leaseMs?: number },
): Promise<BeginStageAttemptResult> {
  const idempotencyKey = idempotencyKeyFor(projectId, stage, version);
  const leaseMs = opts?.leaseMs ?? DEFAULT_LEASE_MS;

  const reconciledFrom = (await reconcileStaleAttempt(ctx, idempotencyKey)) ?? undefined;

  const existing = await findByIdempotencyKey(ctx, idempotencyKey);

  if (existing) {
    if (existing.status === "COMPLETED") {
      return {
        attemptId: existing._id,
        idempotencyKey,
        alreadyCompleted: true,
        cachedResult: existing.result,
        attemptNumber: existing.attemptCount,
      };
    }
    if (existing.status === "IN_PROGRESS") {
      throw new Error(
        `beginStageAttempt: "${idempotencyKey}" is already in flight (lease expires ${existing.leaseExpiresAt ?? "n/a"})`,
      );
    }
    // PENDING or FAILED (including one just reconciled above from a
    // timed-out lease): re-acquire the lease on the same row.
    const attemptNumber = existing.attemptCount + 1;
    await ctx.db.patch(existing._id, {
      status: "IN_PROGRESS",
      attemptCount: attemptNumber,
      leaseExpiresAt: Date.now() + leaseMs,
      error: undefined,
    });
    return {
      attemptId: existing._id,
      idempotencyKey,
      alreadyCompleted: false,
      attemptNumber,
      reconciledFrom,
    };
  }

  const attemptId = await ctx.db.insert("stageAttempts", {
    projectId,
    stage,
    version,
    idempotencyKey,
    status: "IN_PROGRESS",
    leaseExpiresAt: Date.now() + leaseMs,
    attemptCount: 1,
    startedAt: Date.now(),
  });
  return { attemptId, idempotencyKey, alreadyCompleted: false, attemptNumber: 1, reconciledFrom };
}

/**
 * Record the provider + provider-assigned request id for an in-flight
 * attempt as soon as the outbound call is submitted (e.g. right after
 * receiving a session/job id back from Devin, GitHub, Firebase, etc.), so
 * that if the lease later times out before completion, the *next* attempt
 * can reconcile against this same provider resource instead of blindly
 * creating a duplicate (Section 10, "Reconcile timed-out provider
 * requests").
 */
export async function recordProviderRequest(
  ctx: MutationCtx,
  attemptId: Id<"stageAttempts">,
  provider: ProviderName,
  providerRequestId: string,
): Promise<void> {
  await ctx.db.patch(attemptId, { provider, providerRequestId });
}

/** Close out a successful attempt and release its lease. */
export async function completeStageAttempt(
  ctx: MutationCtx,
  attemptId: Id<"stageAttempts">,
  result: unknown,
): Promise<void> {
  await ctx.db.patch(attemptId, {
    status: "COMPLETED",
    result,
    completedAt: Date.now(),
    leaseExpiresAt: undefined,
  });
}

export interface FailStageAttemptResult {
  exhausted: boolean;
  retryable: boolean;
  shouldEscalate: boolean;
  /** Present only when the caller should schedule a retry instead of escalating. */
  backoffMs?: number;
}

/**
 * Close out a failed attempt, release its lease, and report back whether
 * the caller should retry (with a computed backoff) or escalate to manual
 * intervention (retries exhausted or the error is non-retryable).
 */
export async function failStageAttempt(
  ctx: MutationCtx,
  attemptId: Id<"stageAttempts">,
  error: StageError,
  opts?: { maxRetries?: number },
): Promise<FailStageAttemptResult> {
  const attempt = await ctx.db.get(attemptId);
  if (!attempt) {
    throw new Error(`failStageAttempt: stage attempt ${attemptId} not found`);
  }

  await ctx.db.patch(attemptId, {
    status: "FAILED",
    error,
    completedAt: Date.now(),
    leaseExpiresAt: undefined,
  });

  const maxRetries = opts?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const exhausted = attempt.attemptCount >= maxRetries;
  const shouldEscalate = !error.retryable || exhausted;

  return {
    exhausted,
    retryable: error.retryable,
    shouldEscalate,
    backoffMs: shouldEscalate ? undefined : computeBackoffMs(attempt.attemptCount),
  };
}

/**
 * Move a project into MANUAL_INTERVENTION_REQUIRED with an auditable reason
 * once retries are exhausted or the error is non-retryable (Section 10).
 * Delegates the actual state change to `transitionProject` (the shared
 * state-machine contract) rather than patching `projects`/`workflowRuns`
 * here, so the same validation + `activityEvents` audit trail applies as
 * for every other transition. `transitionProject` requires `provider` and
 * `providerRequestId` on every failure metadata payload (PRD Section 8); if
 * the failed attempt never got far enough to record a provider response,
 * this falls back to the attempt's own idempotency key so the audit trail
 * still has a stable, unique reference for that attempt.
 */
export async function escalateToManualIntervention(
  ctx: MutationCtx,
  attemptId: Id<"stageAttempts">,
  info: {
    correlationId: string;
    error: StageError;
    retryCount: number;
    maxRetries: number;
  },
): Promise<void> {
  const attempt = await ctx.db.get(attemptId);
  if (!attempt) {
    throw new Error(`escalateToManualIntervention: stage attempt ${attemptId} not found`);
  }

  await transitionProject(ctx, attempt.projectId, MANUAL_INTERVENTION_REQUIRED, {
    correlationId: info.correlationId,
    stage: attempt.stage,
    failedStage: attempt.stage,
    errorCode: info.error.code ?? info.error.message,
    retryable: info.error.retryable,
    retryCount: info.retryCount,
    maxRetries: info.maxRetries,
    provider: attempt.provider ?? "UNKNOWN",
    providerRequestId: attempt.providerRequestId ?? attempt.idempotencyKey,
    reason: info.error.message,
  });
}
