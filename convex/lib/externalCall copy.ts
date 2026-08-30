import {
  FunctionReference,
  type GenericActionCtx,
  type GenericDataModel,
  makeFunctionReference,
  mutationGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import { v, type GenericId, type Value } from "convex/values";

import {
  beginScopedStageAttempt,
  beginStageAttempt,
  completeStageAttempt,
  failStageAttempt,
  reconcileTimedOutScopedStageAttempt,
  reconcileTimedOutStageAttempt,
  recordStageProviderRequest,
  type ReconciliationOutcome,
  type StageAttemptSnapshot,
  type StageVersion,
} from "./stageAttempt.js";

export type ExternalCallMode = "live" | "replay";

export type ReplayHandler = {
  functionName: string;
  args?: Record<string, Value>;
};

export type ExternalCallMetadata = {
  mode: ExternalCallMode;
  projectId?: GenericId<"projects">;
  scopeKey: string;
  stage: string;
  cacheKey: string;
};

export type ExternalCallAttempt = {
  attemptId: GenericId<"stageAttempts">;
  recordProviderRequest: (providerRequestId: string) => Promise<void>;
};

type CallExternalBaseOptions<T extends Value, R> = {
  stage: string;
  version?: StageVersion;
  provider?: string;
  correlationId?: string;
  maxRetries?: number;
  live: (attempt: ExternalCallAttempt) => Promise<T>;
  cacheKey?: string;
  replayHandler: ReplayHandler;
  providerRequestId?: (response: T) => string | undefined;
  reconcile?: (attempt: StageAttemptSnapshot) => Promise<ReconciliationOutcome<T>>;
  process?: (response: T, metadata: ExternalCallMetadata) => Promise<R> | R;
};

export type CallExternalOptions<T extends Value, R = T> =
  | (CallExternalBaseOptions<T, R> & {
      projectId: GenericId<"projects">;
      scopeKey?: never;
    })
  | (CallExternalBaseOptions<T, R> & {
      projectId?: never;
      scopeKey: string;
    });

export type ExternalCallContext = {
  runMutation: GenericActionCtx<GenericDataModel>["runMutation"];
};

type PrepareExternalCallArgs = {
  projectId?: GenericId<"projects">;
  scopeKey: string;
  stage: string;
  cacheKey: string;
};

type PrepareExternalCallResult =
  | { mode: "live" }
  | { mode: "replay"; response: Value };

type RecordSuccessfulResponseArgs = PrepareExternalCallArgs & {
  response: Value;
  replayHandler?: ReplayHandler;
};

const prepareExternalCallReference = makeFunctionReference<"mutation">(
  "lib/externalCall:prepareExternalCall",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  PrepareExternalCallArgs,
  PrepareExternalCallResult
>;

const recordSuccessfulResponseReference = makeFunctionReference<"mutation">(
  "lib/externalCall:recordSuccessfulResponse",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  RecordSuccessfulResponseArgs,
  null
>;

export async function callExternal<T extends Value, R = T>(
  ctx: ExternalCallContext,
  options: CallExternalOptions<T, R>,
): Promise<R> {
  const cacheKey = options.cacheKey ?? "default";
  const scopeKey: string = options.projectId
    ? String(options.projectId)
    : (options.scopeKey as string);
  const prepared = await ctx.runMutation(prepareExternalCallReference, {
    projectId: options.projectId,
    scopeKey,
    stage: options.stage,
    cacheKey,
  });

  if (prepared.mode === "replay") {
    return await processExternalResponse(options, prepared.response as T, "replay", cacheKey);
  }

  const version = options.version ?? cacheKey;
  const begin = async () =>
    options.projectId
      ? await beginStageAttempt(ctx, options.projectId, options.stage, version)
      : await beginScopedStageAttempt(ctx, scopeKey, options.stage, version);
  let attempt = await begin();
  if (attempt.status === "completed") {
    return await processExternalResponse(options, attempt.result as T, "live", cacheKey);
  }
  if (attempt.status === "reconciliation_required") {
    if (!options.reconcile) {
      throw new Error(`Stage ${options.stage} requires provider reconciliation before retry`);
    }
    const reconciled = options.projectId
      ? await reconcileTimedOutStageAttempt(
          ctx,
          options.projectId,
          options.stage,
          version,
          options.reconcile,
        )
      : await reconcileTimedOutScopedStageAttempt(
          ctx,
          scopeKey,
          options.stage,
          version,
          options.reconcile,
        );
    if (reconciled.status === "completed" || reconciled.status === "already_completed") {
      return await processExternalResponse(options, reconciled.result, "live", cacheKey);
    }
    if (reconciled.status === "still_pending") {
      throw new Error(`Stage ${options.stage} is still pending at the provider`);
    }
    attempt = await begin();
    if (attempt.status !== "acquired") {
      if (attempt.status === "completed") {
        return await processExternalResponse(options, attempt.result as T, "live", cacheKey);
      }
      throw new Error(`Stage ${options.stage} could not acquire a lease after reconciliation`);
    }
  }

  let response: T;
  try {
    response = await options.live({
      attemptId: attempt.attemptId,
      recordProviderRequest: async (providerRequestId) => {
        await recordStageProviderRequest(ctx, attempt.attemptId, providerRequestId);
      },
    });
    const providerRequestId = options.providerRequestId?.(response);
    if (providerRequestId) {
      await recordStageProviderRequest(ctx, attempt.attemptId, providerRequestId);
    }
    await ctx.runMutation(recordSuccessfulResponseReference, {
      projectId: options.projectId,
      scopeKey,
      stage: options.stage,
      cacheKey,
      response,
      replayHandler: options.replayHandler,
    });
    await completeStageAttempt(ctx, attempt.attemptId, response);
  } catch (error) {
    await failStageAttempt(ctx, attempt.attemptId, {
      errorCode: "EXTERNAL_CALL_FAILED",
      message: error instanceof Error ? error.message : "External call failed",
      retryable: true,
      maxRetries: options.maxRetries,
      provider: options.provider,
      correlationId: options.correlationId,
    });
    throw error;
  }
  return await processExternalResponse(options, response, "live", cacheKey);
}

async function processExternalResponse<T extends Value, R>(
  options: CallExternalOptions<T, R>,
  response: T,
  mode: ExternalCallMode,
  cacheKey: string,
): Promise<R> {
  const metadata: ExternalCallMetadata = {
    mode,
    projectId: options.projectId,
    scopeKey: options.projectId
      ? String(options.projectId)
      : (options.scopeKey as string),
    stage: options.stage,
    cacheKey,
  };
  return options.process
    ? await options.process(response, metadata)
    : (response as unknown as R);
}

const cacheArgs = {
  projectId: v.optional(v.id("projects")),
  scopeKey: v.string(),
  stage: v.string(),
  cacheKey: v.string(),
};

export const prepareExternalCall = internalMutationGeneric({
  args: cacheArgs,
  handler: async (ctx, args): Promise<PrepareExternalCallResult> => {
    const project = args.projectId
      ? await ctx.db.get("projects", args.projectId)
      : null;
    if (args.projectId && !project) {
      throw new Error(`Project ${args.projectId} not found`);
    }

    const replayRequest = await ctx.db
      .query("externalReplayRequests")
      .withIndex("by_scope_stage_cache_status", (query) =>
        query.eq("scopeKey", args.scopeKey),
      )
      .filter((query) =>
        query.and(
          query.eq(query.field("stage"), args.stage),
          query.eq(query.field("cacheKey"), args.cacheKey),
          query.eq(query.field("status"), "pending"),
        ),
      )
      .order("asc")
      .first();

    const globalSettings = await ctx.db
      .query("externalCallSettings")
      .withIndex("by_scope", (query) => query.eq("scope", "global"))
      .order("desc")
      .first();

    const projectRecord = (project ?? {}) as Record<string, unknown>;
    const replayStages = Array.isArray(projectRecord.externalCallReplayStages)
      ? projectRecord.externalCallReplayStages
      : [];
    const projectReplay =
      projectRecord.externalCallMode === "replay" ||
      replayStages.includes(args.stage);
    const globalReplay = globalSettings?.mode === "replay";

    if (!replayRequest && !projectReplay && !globalReplay) {
      return { mode: "live" };
    }

    const cached = await ctx.db
      .query("externalCallResponses")
      .withIndex("by_scope_stage_cache_key", (query) =>
        query.eq("scopeKey", args.scopeKey),
      )
      .filter((query) =>
        query.and(
          query.eq(query.field("stage"), args.stage),
          query.eq(query.field("cacheKey"), args.cacheKey),
        ),
      )
      .order("desc")
      .first();

    if (!cached) {
      throw new Error(
        `No successful response exists for project ${args.projectId}, stage ${args.stage}, cache key ${args.cacheKey}`,
      );
    }

    if (replayRequest) {
      await ctx.db.patch("externalReplayRequests", replayRequest._id, {
        status: "claimed",
        claimedAt: Date.now(),
      });
    }

    return { mode: "replay", response: cached.response as Value };
  },
});

export const recordSuccessfulResponse = internalMutationGeneric({
  args: {
    ...cacheArgs,
    response: v.any(),
    replayHandler: v.optional(
      v.object({
        functionName: v.string(),
        args: v.optional(v.any()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("externalCallResponses")
      .withIndex("by_scope_stage_cache_key", (query) =>
        query.eq("scopeKey", args.scopeKey),
      )
      .filter((query) =>
        query.and(
          query.eq(query.field("stage"), args.stage),
          query.eq(query.field("cacheKey"), args.cacheKey),
        ),
      )
      .order("desc")
      .first();

    const value = {
      projectId: args.projectId,
      scopeKey: args.scopeKey,
      stage: args.stage,
      cacheKey: args.cacheKey,
      response: args.response,
      lastSucceededAt: Date.now(),
      ...(args.replayHandler ? { replayHandler: args.replayHandler } : {}),
    };

    if (existing) {
      await ctx.db.patch("externalCallResponses", existing._id, value);
    } else {
      await ctx.db.insert("externalCallResponses", value);
    }

    return null;
  },
});

export const replayLastResponse = mutationGeneric({
  args: {
    projectId: v.id("projects"),
    stage: v.string(),
    cacheKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // NOTE: Admin authentication is intentionally disabled for now; any user
    // can call this. Authentication will be added back in a future pass.
    const project = await ctx.db.get("projects", args.projectId);
    if (!project) {
      throw new Error(`Project ${args.projectId} not found`);
    }
    if ((project as Record<string, unknown>).state !== "MANUAL_INTERVENTION_REQUIRED") {
      throw new Error(
        "Replay is only allowed while the project is in MANUAL_INTERVENTION_REQUIRED",
      );
    }

    const cacheKey = args.cacheKey ?? "default";
    const scopeKey = String(args.projectId);
    const cached = await ctx.db
      .query("externalCallResponses")
      .withIndex("by_scope_stage_cache_key", (query) =>
        query.eq("scopeKey", scopeKey),
      )
      .filter((query) =>
        query.and(
          query.eq(query.field("stage"), args.stage),
          query.eq(query.field("cacheKey"), cacheKey),
        ),
      )
      .order("desc")
      .first();

    if (!cached) {
      throw new Error(
        `No successful response exists for project ${args.projectId}, stage ${args.stage}, cache key ${cacheKey}`,
      );
    }

    const replayHandler = cached.replayHandler as ReplayHandler | undefined;
    if (!replayHandler) {
      throw new Error(
        `No replay handler is registered for project ${args.projectId}, stage ${args.stage}`,
      );
    }

    const replayRequestId = await ctx.db.insert("externalReplayRequests", {
      projectId: args.projectId,
      scopeKey,
      stage: args.stage,
      cacheKey,
      status: "pending",
      requestedAt: Date.now(),
    });

    const functionReference = makeFunctionReference<"action">(
      replayHandler.functionName,
    );
    const scheduledFunctionId = await ctx.scheduler.runAfter(
      0,
      functionReference,
      {
        ...(replayHandler.args ?? {}),
        projectId: args.projectId,
      },
    );

    return { replayRequestId, scheduledFunctionId };
  },
});

// Lets the Admin UI (T7.3) discover which stages have a cached
// last-successful-response for a project, so "Replay Last Response" can be
// offered per-stage only where it would actually do something.
export const listCachedResponses = queryGeneric({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("externalCallResponses")
      .withIndex("by_project_stage_cache_key", (query) => query.eq("projectId", args.projectId))
      .collect();
    return rows.map((row) => ({
      stage: row.stage,
      cacheKey: row.cacheKey,
      lastSucceededAt: row.lastSucceededAt,
    }));
  },
});
