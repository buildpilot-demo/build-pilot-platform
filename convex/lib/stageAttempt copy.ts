import {
  type FunctionReference,
  type GenericActionCtx,
  type GenericDataModel,
  internalMutationGeneric,
  makeFunctionReference,
} from "convex/server";
import { v, type GenericId, type Value } from "convex/values";

import { transitionProject, type StateMachineContext } from "../stateMachine.js";

export const DEFAULT_LEASE_DURATION_MS = 5 * 60 * 1000;
export const DEFAULT_MAX_RETRIES = 3;

export type StageAttemptId = GenericId<"stageAttempts">;
export type ProjectId = GenericId<"projects">;
export type StageVersion = string | number;

export type StageAttemptError = {
  errorCode: string;
  message: string;
  retryable: boolean;
  maxRetries?: number;
  provider?: string;
  providerRequestId?: string;
  correlationId?: string;
};

export type StageAttemptSnapshot = {
  attemptId: StageAttemptId;
  projectId?: ProjectId;
  scopeKey?: string;
  stage: string;
  version: StageVersion;
  idempotencyKey: string;
  attemptNumber: number;
  status: string;
  leaseExpiresAt: number;
  providerRequestId?: string;
};

export type BeginStageAttemptResult =
  | {
      status: "acquired";
      attemptId: StageAttemptId;
      idempotencyKey: string;
      attemptNumber: number;
      leaseExpiresAt: number;
    }
  | {
      status: "completed";
      attemptId: StageAttemptId;
      idempotencyKey: string;
      result: Value;
    }
  | {
      status: "reconciliation_required";
      attempt: StageAttemptSnapshot;
    };

export type FailStageAttemptResult =
  | {
      status: "retry_scheduled";
      retryCount: number;
      maxRetries: number;
      nextRetryAt: number;
    }
  | {
      status: "manual_intervention_required";
      retryCount: number;
      maxRetries: number;
    };

export type ReconciliationOutcome<T extends Value> =
  | { status: "succeeded"; result: T }
  | {
      status: "pending";
      providerRequestId?: string;
      leaseDurationMs?: number;
    }
  | { status: "not_found" };

export type ReconciliationResult<T extends Value> =
  | { status: "completed"; attemptId: StageAttemptId; result: T }
  | {
      status: "still_pending";
      attemptId: StageAttemptId;
      leaseExpiresAt: number;
    }
  | { status: "replacement_allowed"; attemptId: StageAttemptId }
  | { status: "not_required" }
  | { status: "already_completed"; attemptId: StageAttemptId; result: T };

export type BackoffOptions = {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  random?: () => number;
};

export type StageAttemptContext = {
  runMutation: GenericActionCtx<GenericDataModel>["runMutation"];
};

type StageIdentityArgs = {
  projectId?: ProjectId;
  scopeKey?: string;
  stage: string;
  version: StageVersion;
};

type CompleteArgs = {
  attemptId: StageAttemptId;
  result: Value;
};

type FailArgs = {
  attemptId: StageAttemptId;
  error: StageAttemptError;
};

type ClaimReconciliationResult =
  | { status: "claimed"; attempt: StageAttemptSnapshot; reconciliationToken: string }
  | { status: "active" }
  | { status: "not_required" }
  | { status: "completed"; attemptId: StageAttemptId; result: Value };

type FinalizeReconciliationArgs = {
  attemptId: StageAttemptId;
  reconciliationToken: string;
  outcome: ReconciliationOutcome<Value>;
};

const beginReference = makeFunctionReference<"mutation">(
  "lib/stageAttempt:beginStageAttemptMutation",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  StageIdentityArgs,
  | BeginStageAttemptResult
  | { status: "lease_conflict"; leaseExpiresAt: number }
  | { status: "retry_not_ready"; nextRetryAt: number }
  | { status: "retries_exhausted" }
>;

const completeReference = makeFunctionReference<"mutation">(
  "lib/stageAttempt:completeStageAttemptMutation",
) as unknown as FunctionReference<"mutation", "internal", CompleteArgs, null>;

const failReference = makeFunctionReference<"mutation">(
  "lib/stageAttempt:failStageAttemptMutation",
) as unknown as FunctionReference<"mutation", "internal", FailArgs, FailStageAttemptResult>;

const recordProviderRequestReference = makeFunctionReference<"mutation">(
  "lib/stageAttempt:recordStageProviderRequestMutation",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  { attemptId: StageAttemptId; providerRequestId: string },
  null
>;

const claimReconciliationReference = makeFunctionReference<"mutation">(
  "lib/stageAttempt:claimReconciliationMutation",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  StageIdentityArgs,
  ClaimReconciliationResult
>;

const finalizeReconciliationReference = makeFunctionReference<"mutation">(
  "lib/stageAttempt:finalizeReconciliationMutation",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  FinalizeReconciliationArgs,
  ReconciliationResult<Value>
>;

export class StageLeaseConflictError extends Error {
  constructor(
    readonly idempotencyKey: string,
    readonly leaseExpiresAt: number,
  ) {
    super(`Stage attempt ${idempotencyKey} is leased until ${leaseExpiresAt}`);
    this.name = "StageLeaseConflictError";
  }
}

export class StageRetryNotReadyError extends Error {
  constructor(
    readonly idempotencyKey: string,
    readonly nextRetryAt: number,
  ) {
    super(`Stage attempt ${idempotencyKey} cannot retry before ${nextRetryAt}`);
    this.name = "StageRetryNotReadyError";
  }
}

export class StageRetriesExhaustedError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Stage attempt ${idempotencyKey} requires manual intervention`);
    this.name = "StageRetriesExhaustedError";
  }
}

export function stageIdempotencyKey(
  projectId: ProjectId,
  stage: string,
  version: StageVersion,
): string {
  if (!stage.trim()) {
    throw new Error("Stage must not be empty");
  }
  if (String(version).length === 0) {
    throw new Error("Stage version must not be empty");
  }
  return `${projectId}:${stage}:${version}`;
}

export function scopedStageIdempotencyKey(
  scopeKey: string,
  stage: string,
  version: StageVersion,
): string {
  if (!scopeKey.trim()) throw new Error("Scope key must not be empty");
  return stageIdempotencyKey(scopeKey as ProjectId, stage, version);
}

export function boundedExponentialBackoff(
  retryCount: number,
  options: BackoffOptions = {},
): number {
  if (!Number.isInteger(retryCount) || retryCount < 1) {
    throw new Error("retryCount must be a positive integer");
  }
  const baseDelayMs = options.baseDelayMs ?? 1_000;
  const maxDelayMs = options.maxDelayMs ?? 60_000;
  const jitterRatio = options.jitterRatio ?? 0.2;
  if (baseDelayMs < 0 || maxDelayMs < baseDelayMs || jitterRatio < 0 || jitterRatio > 1) {
    throw new Error("Invalid backoff options");
  }

  const boundedDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** (retryCount - 1));
  const jitter = boundedDelay * jitterRatio;
  const randomValue = Math.min(1, Math.max(0, (options.random ?? Math.random)()));
  return Math.round(
    Math.min(maxDelayMs, Math.max(0, boundedDelay - jitter + randomValue * jitter * 2)),
  );
}

export async function beginStageAttempt(
  ctx: StageAttemptContext,
  projectId: ProjectId,
  stage: string,
  version: StageVersion,
): Promise<BeginStageAttemptResult> {
  const result = await ctx.runMutation(beginReference, { projectId, stage, version });
  const idempotencyKey = stageIdempotencyKey(projectId, stage, version);
  if (result.status === "lease_conflict") {
    throw new StageLeaseConflictError(idempotencyKey, result.leaseExpiresAt);
  }
  if (result.status === "retry_not_ready") {
    throw new StageRetryNotReadyError(idempotencyKey, result.nextRetryAt);
  }
  if (result.status === "retries_exhausted") {
    throw new StageRetriesExhaustedError(idempotencyKey);
  }
  return result;
}

export async function beginScopedStageAttempt(
  ctx: StageAttemptContext,
  scopeKey: string,
  stage: string,
  version: StageVersion,
): Promise<BeginStageAttemptResult> {
  const result = await ctx.runMutation(beginReference, { scopeKey, stage, version });
  const idempotencyKey = scopedStageIdempotencyKey(scopeKey, stage, version);
  if (result.status === "lease_conflict") {
    throw new StageLeaseConflictError(idempotencyKey, result.leaseExpiresAt);
  }
  if (result.status === "retry_not_ready") {
    throw new StageRetryNotReadyError(idempotencyKey, result.nextRetryAt);
  }
  if (result.status === "retries_exhausted") {
    throw new StageRetriesExhaustedError(idempotencyKey);
  }
  return result;
}

export async function completeStageAttempt<T extends Value>(
  ctx: StageAttemptContext,
  attemptId: StageAttemptId,
  result: T,
): Promise<void> {
  await ctx.runMutation(completeReference, { attemptId, result });
}

export async function failStageAttempt(
  ctx: StageAttemptContext,
  attemptId: StageAttemptId,
  error: StageAttemptError,
): Promise<FailStageAttemptResult> {
  return await ctx.runMutation(failReference, { attemptId, error });
}

export async function recordStageProviderRequest(
  ctx: StageAttemptContext,
  attemptId: StageAttemptId,
  providerRequestId: string,
): Promise<void> {
  if (!providerRequestId.trim()) {
    throw new Error("Provider request ID must not be empty");
  }
  await ctx.runMutation(recordProviderRequestReference, { attemptId, providerRequestId });
}

export async function reconcileTimedOutStageAttempt<T extends Value>(
  ctx: StageAttemptContext,
  projectId: ProjectId,
  stage: string,
  version: StageVersion,
  reconcile: (attempt: StageAttemptSnapshot) => Promise<ReconciliationOutcome<T>>,
): Promise<ReconciliationResult<T>> {
  const claimed = await ctx.runMutation(claimReconciliationReference, {
    projectId,
    stage,
    version,
  });

  if (claimed.status === "active" || claimed.status === "not_required") {
    return { status: "not_required" };
  }
  if (claimed.status === "completed") {
    return {
      status: "already_completed",
      attemptId: claimed.attemptId,
      result: claimed.result as T,
    };
  }

  const outcome = await reconcile(claimed.attempt);
  return (await ctx.runMutation(finalizeReconciliationReference, {
    attemptId: claimed.attempt.attemptId,
    reconciliationToken: claimed.reconciliationToken,
    outcome,
  })) as ReconciliationResult<T>;
}

export async function reconcileTimedOutScopedStageAttempt<T extends Value>(
  ctx: StageAttemptContext,
  scopeKey: string,
  stage: string,
  version: StageVersion,
  reconcile: (attempt: StageAttemptSnapshot) => Promise<ReconciliationOutcome<T>>,
): Promise<ReconciliationResult<T>> {
  const claimed = await ctx.runMutation(claimReconciliationReference, {
    scopeKey,
    stage,
    version,
  });
  if (claimed.status === "active" || claimed.status === "not_required") {
    return { status: "not_required" };
  }
  if (claimed.status === "completed") {
    return {
      status: "already_completed",
      attemptId: claimed.attemptId,
      result: claimed.result as T,
    };
  }
  const outcome = await reconcile(claimed.attempt);
  return (await ctx.runMutation(finalizeReconciliationReference, {
    attemptId: claimed.attempt.attemptId,
    reconciliationToken: claimed.reconciliationToken,
    outcome,
  })) as ReconciliationResult<T>;
}

const stageIdentityValidators = {
  projectId: v.optional(v.id("projects")),
  scopeKey: v.optional(v.string()),
  stage: v.string(),
  version: v.union(v.string(), v.number()),
};

const errorValidator = v.object({
  errorCode: v.string(),
  message: v.string(),
  retryable: v.boolean(),
  maxRetries: v.optional(v.number()),
  provider: v.optional(v.string()),
  providerRequestId: v.optional(v.string()),
  correlationId: v.optional(v.string()),
});

function snapshot(attempt: Record<string, unknown>): StageAttemptSnapshot {
  return {
    attemptId: attempt._id as StageAttemptId,
    projectId: attempt.projectId as ProjectId | undefined,
    scopeKey: attempt.scopeKey as string | undefined,
    stage: attempt.stage as string,
    version: attempt.version as StageVersion,
    idempotencyKey: attempt.idempotencyKey as string,
    attemptNumber: attempt.attemptNumber as number,
    status: attempt.status as string,
    leaseExpiresAt: attempt.leaseExpiresAt as number,
    providerRequestId: attempt.providerRequestId as string | undefined,
  };
}

function token(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export const beginStageAttemptMutation = internalMutationGeneric({
  args: stageIdentityValidators,
  handler: async (ctx, args) => {
    if (Boolean(args.projectId) === Boolean(args.scopeKey)) {
      throw new Error("Exactly one of projectId or scopeKey is required");
    }
    const project = args.projectId
      ? await ctx.db.get("projects", args.projectId)
      : null;
    if (args.projectId && !project) {
      throw new Error(`Project ${args.projectId} not found`);
    }

    const scopeKey = args.projectId ? String(args.projectId) : args.scopeKey!;
    const idempotencyKey = scopedStageIdempotencyKey(scopeKey, args.stage, args.version);
    const attempts = await ctx.db
      .query("stageAttempts")
      .withIndex("by_idempotency_key", (query) =>
        query.eq("idempotencyKey", idempotencyKey),
      )
      .order("desc")
      .collect();
    const completed = attempts.find((attempt) => attempt.status === "completed");
    if (completed) {
      return {
        status: "completed" as const,
        attemptId: completed._id,
        idempotencyKey,
        result: (completed.result ?? null) as Value,
      };
    }

    const current = attempts.find(
      (attempt) => attempt.status === "in_progress" || attempt.status === "reconciling",
    );
    const now = Date.now();
    if (current && current.leaseExpiresAt > now) {
      return {
        status: "lease_conflict" as const,
        leaseExpiresAt: current.leaseExpiresAt as number,
      };
    }
    if (current) {
      return { status: "reconciliation_required" as const, attempt: snapshot(current) };
    }

    const latest = attempts[0];
    if (latest?.status === "failed") {
      const retryCount = (latest.retryCount as number | undefined) ?? latest.attemptNumber;
      const maxRetries = (latest.maxRetries as number | undefined) ?? DEFAULT_MAX_RETRIES;
      const previousError = latest.error as Record<string, unknown> | undefined;
      if (previousError?.retryable === false || retryCount >= maxRetries) {
        return { status: "retries_exhausted" as const };
      }
      if (typeof latest.nextRetryAt === "number" && latest.nextRetryAt > now) {
        return { status: "retry_not_ready" as const, nextRetryAt: latest.nextRetryAt };
      }
    }

    const attemptNumber = attempts.length + 1;
    const leaseExpiresAt = now + DEFAULT_LEASE_DURATION_MS;
    const attemptId = await ctx.db.insert("stageAttempts", {
      projectId: args.projectId,
      scopeKey: args.scopeKey,
      workflowRunId: project
        ? (project as Record<string, unknown>).workflowRunId
        : undefined,
      stage: args.stage,
      version: args.version,
      idempotencyKey,
      attemptNumber,
      retryCount: attemptNumber,
      status: "in_progress",
      leaseExpiresAt,
      startedAt: now,
      updatedAt: now,
    });

    return {
      status: "acquired" as const,
      attemptId,
      idempotencyKey,
      attemptNumber,
      leaseExpiresAt,
    };
  },
});

export const completeStageAttemptMutation = internalMutationGeneric({
  args: { attemptId: v.id("stageAttempts"), result: v.any() },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get("stageAttempts", args.attemptId);
    if (!attempt) {
      throw new Error(`Stage attempt ${args.attemptId} not found`);
    }
    if (attempt.status === "completed") {
      return null;
    }
    if (attempt.status !== "in_progress") {
      throw new Error(`Cannot complete stage attempt in status ${attempt.status}`);
    }

    const now = Date.now();
    await ctx.db.patch("stageAttempts", args.attemptId, {
      status: "completed",
      result: args.result,
      completedAt: now,
      updatedAt: now,
      leaseExpiresAt: now,
    });
    return null;
  },
});

export const recordStageProviderRequestMutation = internalMutationGeneric({
  args: {
    attemptId: v.id("stageAttempts"),
    providerRequestId: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.providerRequestId.trim()) {
      throw new Error("Provider request ID must not be empty");
    }
    const attempt = await ctx.db.get("stageAttempts", args.attemptId);
    if (!attempt) {
      throw new Error(`Stage attempt ${args.attemptId} not found`);
    }
    if (attempt.status !== "in_progress") {
      throw new Error(`Cannot record a provider request in status ${attempt.status}`);
    }
    await ctx.db.patch("stageAttempts", args.attemptId, {
      providerRequestId: args.providerRequestId,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const failStageAttemptMutation = internalMutationGeneric({
  args: { attemptId: v.id("stageAttempts"), error: errorValidator },
  handler: async (ctx, args): Promise<FailStageAttemptResult> => {
    const attempt = await ctx.db.get("stageAttempts", args.attemptId);
    if (!attempt) {
      throw new Error(`Stage attempt ${args.attemptId} not found`);
    }
    if (attempt.status === "failed") {
      const retryCount = attempt.retryCount as number;
      const maxRetries = attempt.maxRetries as number;
      return typeof attempt.nextRetryAt === "number"
        ? {
            status: "retry_scheduled",
            retryCount,
            maxRetries,
            nextRetryAt: attempt.nextRetryAt,
          }
        : { status: "manual_intervention_required", retryCount, maxRetries };
    }
    if (attempt.status !== "in_progress" && attempt.status !== "reconciling") {
      throw new Error(`Cannot fail stage attempt in status ${attempt.status}`);
    }

    const now = Date.now();
    const retryCount = attempt.attemptNumber as number;
    const maxRetries = args.error.maxRetries ?? DEFAULT_MAX_RETRIES;
    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
      throw new Error("maxRetries must be a non-negative integer");
    }
    const exhausted = !args.error.retryable || retryCount >= maxRetries;
    const nextRetryAt = exhausted
      ? undefined
      : now + boundedExponentialBackoff(retryCount);
    const sanitizedError = {
      errorCode: args.error.errorCode,
      message: args.error.message,
      retryable: args.error.retryable,
      provider: args.error.provider ?? "unknown",
      providerRequestId: args.error.providerRequestId ?? "unknown",
      correlationId: args.error.correlationId ?? `${attempt.idempotencyKey}:${retryCount}`,
    };

    await ctx.db.patch("stageAttempts", args.attemptId, {
      status: "failed",
      error: sanitizedError,
      retryCount,
      maxRetries,
      failedAt: now,
      updatedAt: now,
      leaseExpiresAt: now,
      nextRetryAt,
    });

    if (!exhausted) {
      return { status: "retry_scheduled", retryCount, maxRetries, nextRetryAt: nextRetryAt! };
    }

    if (attempt.projectId) {
      await transitionProject(
        ctx as unknown as StateMachineContext,
        attempt.projectId as Parameters<typeof transitionProject>[1],
        "MANUAL_INTERVENTION_REQUIRED",
        {
          workflowRunId: attempt.workflowRunId as Parameters<
            typeof transitionProject
          >[3]["workflowRunId"],
          stage: String(attempt.stage),
          failedStage: String(attempt.stage),
          errorCode: sanitizedError.errorCode,
          errorMessage: sanitizedError.message,
          retryable: sanitizedError.retryable,
          retryCount,
          maxRetries,
          lastAttemptAt: now,
          provider: sanitizedError.provider,
          providerRequestId: sanitizedError.providerRequestId,
          correlationId: sanitizedError.correlationId,
        },
      );
    } else {
      await ctx.db.insert("integrationEvents", {
        stageAttemptId: args.attemptId,
        provider: sanitizedError.provider,
        providerRequestId: sanitizedError.providerRequestId,
        stage: String(attempt.stage),
        operation: "scoped_external_call",
        direction: "outbound",
        outcome: "failed",
        correlationId: sanitizedError.correlationId,
        sanitizedError: sanitizedError.message,
        timestamp: now,
      });
    }

    return { status: "manual_intervention_required", retryCount, maxRetries };
  },
});

export const claimReconciliationMutation = internalMutationGeneric({
  args: stageIdentityValidators,
  handler: async (ctx, args): Promise<ClaimReconciliationResult> => {
    if (Boolean(args.projectId) === Boolean(args.scopeKey)) {
      throw new Error("Exactly one of projectId or scopeKey is required");
    }
    const idempotencyKey = scopedStageIdempotencyKey(
      args.projectId ? String(args.projectId) : args.scopeKey!,
      args.stage,
      args.version,
    );
    const attempts = await ctx.db
      .query("stageAttempts")
      .withIndex("by_idempotency_key", (query) =>
        query.eq("idempotencyKey", idempotencyKey),
      )
      .order("desc")
      .collect();
    const completed = attempts.find((attempt) => attempt.status === "completed");
    if (completed) {
      return {
        status: "completed",
        attemptId: completed._id,
        result: (completed.result ?? null) as Value,
      };
    }

    const current = attempts.find(
      (attempt) => attempt.status === "in_progress" || attempt.status === "reconciling",
    );
    if (!current) {
      return { status: "not_required" };
    }
    const now = Date.now();
    if (current.leaseExpiresAt > now) {
      return { status: "active" };
    }

    const reconciliationToken = token();
    await ctx.db.patch("stageAttempts", current._id, {
      status: "reconciling",
      reconciliationToken,
      leaseExpiresAt: now + DEFAULT_LEASE_DURATION_MS,
      reconciliationStartedAt: now,
      updatedAt: now,
    });
    return { status: "claimed", attempt: snapshot(current), reconciliationToken };
  },
});

export const finalizeReconciliationMutation = internalMutationGeneric({
  args: {
    attemptId: v.id("stageAttempts"),
    reconciliationToken: v.string(),
    outcome: v.union(
      v.object({ status: v.literal("succeeded"), result: v.any() }),
      v.object({
        status: v.literal("pending"),
        providerRequestId: v.optional(v.string()),
        leaseDurationMs: v.optional(v.number()),
      }),
      v.object({ status: v.literal("not_found") }),
    ),
  },
  handler: async (ctx, args): Promise<ReconciliationResult<Value>> => {
    const attempt = await ctx.db.get("stageAttempts", args.attemptId);
    if (!attempt) {
      throw new Error(`Stage attempt ${args.attemptId} not found`);
    }
    if (
      attempt.status !== "reconciling" ||
      attempt.reconciliationToken !== args.reconciliationToken
    ) {
      throw new Error(`Reconciliation lease was lost for stage attempt ${args.attemptId}`);
    }

    const now = Date.now();
    if (args.outcome.status === "succeeded") {
      await ctx.db.patch("stageAttempts", args.attemptId, {
        status: "completed",
        result: args.outcome.result,
        completedAt: now,
        reconciledAt: now,
        updatedAt: now,
        leaseExpiresAt: now,
        reconciliationToken: undefined,
      });
      return { status: "completed", attemptId: args.attemptId, result: args.outcome.result };
    }

    if (args.outcome.status === "pending") {
      const leaseDurationMs = args.outcome.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
      if (!Number.isFinite(leaseDurationMs) || leaseDurationMs <= 0) {
        throw new Error("Reconciliation lease duration must be positive");
      }
      const leaseExpiresAt = now + leaseDurationMs;
      await ctx.db.patch("stageAttempts", args.attemptId, {
        status: "in_progress",
        providerRequestId: args.outcome.providerRequestId ?? attempt.providerRequestId,
        leaseExpiresAt,
        reconciledAt: now,
        updatedAt: now,
        reconciliationToken: undefined,
      });
      return { status: "still_pending", attemptId: args.attemptId, leaseExpiresAt };
    }

    await ctx.db.patch("stageAttempts", args.attemptId, {
      status: "reconciled_not_found",
      reconciledAt: now,
      updatedAt: now,
      leaseExpiresAt: now,
      reconciliationToken: undefined,
    });
    return { status: "replacement_allowed", attemptId: args.attemptId };
  },
});
