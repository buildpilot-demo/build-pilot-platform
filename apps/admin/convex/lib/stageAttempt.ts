import { v } from 'convex/values'
import { internalMutation, type MutationCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'

/**
 * Durable stage-attempt lifecycle (shared contract #3, docs/task-plan.md
 * Section 3; rules in docs/project-requirements.md Section 10).
 *
 * `beginStageAttempt`/`completeStageAttempt`/`failStageAttempt` are plain
 * functions meant to be called from within a mutation (they take a
 * `MutationCtx`). Actions have no direct db access, so `callExternal` in
 * `./externalCall.ts` drives the same lifecycle via the `begin`/`complete`/
 * `fail` internal mutations exported below.
 */

const DEFAULT_LEASE_DURATION_MS = 5 * 60 * 1000 // 5 minutes

export interface BeginStageAttemptArgs {
  stage: string
  projectId?: Id<'projects'>
  workflowRunId?: Id<'workflowRuns'>
  idempotencyKey: string
  provider?: string
  leaseDurationMs?: number
}

export interface BeginStageAttemptResult {
  stageAttemptId: Id<'stageAttempts'>
  /**
   * Set when a previous attempt with this idempotency key already
   * succeeded. Callers must short-circuit and reuse `result` instead of
   * calling the external provider again.
   */
  alreadySucceeded: boolean
  result?: unknown
}

/** Claims (or reclaims, if the previous lease expired) a stage attempt for the given idempotency key. */
export async function beginStageAttempt(
  ctx: MutationCtx,
  args: BeginStageAttemptArgs,
): Promise<BeginStageAttemptResult> {
  const now = Date.now()
  const leaseDurationMs = args.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS

  const existing = await ctx.db
    .query('stageAttempts')
    .withIndex('by_idempotencyKey', (q) => q.eq('idempotencyKey', args.idempotencyKey))
    .unique()

  if (!existing) {
    const stageAttemptId = await ctx.db.insert('stageAttempts', {
      stage: args.stage,
      projectId: args.projectId,
      workflowRunId: args.workflowRunId,
      idempotencyKey: args.idempotencyKey,
      status: 'in_progress',
      attempt: 1,
      provider: args.provider,
      leaseExpiresAt: now + leaseDurationMs,
      startedAt: now,
    })
    return { stageAttemptId, alreadySucceeded: false }
  }

  if (existing.status === 'succeeded') {
    return { stageAttemptId: existing._id, alreadySucceeded: true, result: existing.result }
  }

  if (
    existing.status === 'in_progress' &&
    existing.leaseExpiresAt &&
    existing.leaseExpiresAt > now
  ) {
    throw new Error(
      `Stage attempt for "${args.idempotencyKey}" is already in progress (lease held until ${new Date(
        existing.leaseExpiresAt,
      ).toISOString()}).`,
    )
  }

  // Lease expired or the previous attempt failed: reclaim it for a new attempt
  // rather than inserting a duplicate row for the same idempotency key.
  await ctx.db.patch(existing._id, {
    status: 'in_progress',
    attempt: existing.attempt + 1,
    leaseExpiresAt: now + leaseDurationMs,
    startedAt: now,
    completedAt: undefined,
    errorCode: undefined,
    errorMessage: undefined,
    retryable: undefined,
  })
  return { stageAttemptId: existing._id, alreadySucceeded: false }
}

export async function completeStageAttempt(
  ctx: MutationCtx,
  args: { stageAttemptId: Id<'stageAttempts'>; result?: unknown },
): Promise<void> {
  await ctx.db.patch(args.stageAttemptId, {
    status: 'succeeded',
    result: args.result,
    leaseExpiresAt: undefined,
    completedAt: Date.now(),
  })
}

export async function failStageAttempt(
  ctx: MutationCtx,
  args: {
    stageAttemptId: Id<'stageAttempts'>
    errorCode: string
    errorMessage: string
    retryable: boolean
  },
): Promise<void> {
  await ctx.db.patch(args.stageAttemptId, {
    status: 'failed',
    errorCode: args.errorCode,
    errorMessage: args.errorMessage,
    retryable: args.retryable,
    leaseExpiresAt: undefined,
    completedAt: Date.now(),
  })
}

// --- internal-mutation wrappers, for actions calling via ctx.runMutation ---

export const begin = internalMutation({
  args: {
    stage: v.string(),
    projectId: v.optional(v.id('projects')),
    workflowRunId: v.optional(v.id('workflowRuns')),
    idempotencyKey: v.string(),
    provider: v.optional(v.string()),
    leaseDurationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => beginStageAttempt(ctx, args),
})

export const complete = internalMutation({
  args: {
    stageAttemptId: v.id('stageAttempts'),
    result: v.optional(v.any()),
  },
  handler: async (ctx, args) => completeStageAttempt(ctx, args),
})

export const fail = internalMutation({
  args: {
    stageAttemptId: v.id('stageAttempts'),
    errorCode: v.string(),
    errorMessage: v.string(),
    retryable: v.boolean(),
  },
  handler: async (ctx, args) => failStageAttempt(ctx, args),
})
