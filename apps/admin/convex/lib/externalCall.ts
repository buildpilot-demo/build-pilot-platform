import { v } from 'convex/values'
import { internalMutation, internalQuery, type ActionCtx } from '../_generated/server'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'

/**
 * Thin wrapper every external-call action wraps its provider call in
 * (shared contract #4, docs/task-plan.md Section 3). Implements:
 * - a stageAttempt lease/idempotency record around the call (Section 10),
 * - "replay last successful response" fallback for demo resilience
 *   (Section 9) when `live: false`,
 * - a durable log of the response in `integrationEvents` used both for
 *   replay and for audit history.
 */
export interface CallExternalArgs<T> {
  stage: string
  projectId?: Id<'projects'>
  /** Deterministic key identifying this request; used for both the stageAttempt idempotency key and the replay cache. */
  cacheKey: string
  /** `false` skips the live provider call and replays the last successful response for this stage+cacheKey instead. */
  live: boolean
  provider: string
  /** Performs the actual provider call. Only invoked when `live` is true and no cached successful response already exists. */
  fn: () => Promise<T>
}

export async function callExternal<T>(ctx: ActionCtx, args: CallExternalArgs<T>): Promise<T> {
  const idempotencyKey = `${args.stage}:${args.cacheKey}`

  const claim = await ctx.runMutation(internal.lib.stageAttempt.begin, {
    stage: args.stage,
    projectId: args.projectId,
    idempotencyKey,
    provider: args.provider,
  })

  if (claim.alreadySucceeded) {
    return claim.result as T
  }

  if (!args.live) {
    const cached = await ctx.runQuery(internal.lib.externalCall.getLastSuccessfulResponse, {
      stage: args.stage,
      cacheKey: args.cacheKey,
    })
    if (cached === null) {
      const message = `No cached response available to replay for stage "${args.stage}" (cacheKey "${args.cacheKey}").`
      await ctx.runMutation(internal.lib.stageAttempt.fail, {
        stageAttemptId: claim.stageAttemptId,
        errorCode: 'NO_REPLAY_AVAILABLE',
        errorMessage: message,
        retryable: false,
      })
      throw new Error(message)
    }
    await ctx.runMutation(internal.lib.stageAttempt.complete, {
      stageAttemptId: claim.stageAttemptId,
      result: cached,
    })
    return cached as T
  }

  try {
    const result = await args.fn()
    await ctx.runMutation(internal.lib.stageAttempt.complete, {
      stageAttemptId: claim.stageAttemptId,
      result,
    })
    await ctx.runMutation(internal.lib.externalCall.recordIntegrationEvent, {
      stage: args.stage,
      cacheKey: args.cacheKey,
      provider: args.provider,
      projectId: args.projectId,
      outcome: 'success',
      payload: result,
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await ctx.runMutation(internal.lib.stageAttempt.fail, {
      stageAttemptId: claim.stageAttemptId,
      errorCode: 'EXTERNAL_CALL_FAILED',
      errorMessage: message,
      retryable: true,
    })
    await ctx.runMutation(internal.lib.externalCall.recordIntegrationEvent, {
      stage: args.stage,
      cacheKey: args.cacheKey,
      provider: args.provider,
      projectId: args.projectId,
      outcome: 'failure',
      payload: { error: message },
    })
    throw error
  }
}

export const getLastSuccessfulResponse = internalQuery({
  args: { stage: v.string(), cacheKey: v.string() },
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query('integrationEvents')
      .withIndex('by_stage_cacheKey_outcome', (q) =>
        q.eq('stage', args.stage).eq('cacheKey', args.cacheKey).eq('outcome', 'success'),
      )
      .order('desc')
      .first()
    return event ? event.payload : null
  },
})

export const recordIntegrationEvent = internalMutation({
  args: {
    stage: v.string(),
    cacheKey: v.string(),
    provider: v.string(),
    projectId: v.optional(v.id('projects')),
    outcome: v.union(v.literal('success'), v.literal('failure')),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('integrationEvents', { ...args, createdAt: Date.now() })
  },
})
