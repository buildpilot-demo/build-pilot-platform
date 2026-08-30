import { describe, expect, it, vi } from "vitest";
import type { GenericId, Value } from "convex/values";
import {
  callExternal,
  type ExternalCallContext,
  type ExternalCallMetadata,
} from "../convex/lib/externalCall.js";

const projectId = "project-1" as GenericId<"projects">;

function contextWithResults(...results: Value[]): {
  ctx: ExternalCallContext;
  runMutation: ReturnType<typeof vi.fn>;
} {
  const runMutation = vi.fn();
  for (const result of results) {
    runMutation.mockResolvedValueOnce(result);
  }
  return { ctx: { runMutation } as ExternalCallContext, runMutation };
}

describe("callExternal", () => {
  it("calls live, stores the successful response, and processes it", async () => {
    const { ctx, runMutation } = contextWithResults(
      { mode: "live" },
      {
        status: "acquired",
        attemptId: "attempt-1",
        idempotencyKey: `${projectId}:OPENAI_EXTRACTION:requirements-v1`,
        attemptNumber: 1,
        leaseExpiresAt: 1,
      },
      null,
      null,
    );
    const live = vi.fn().mockResolvedValue({ providerId: "live-1" });
    const process = vi.fn(
      (response: { providerId: string }, metadata: ExternalCallMetadata) => ({
        response,
        mode: metadata.mode,
      }),
    );

    const result = await callExternal(ctx, {
      projectId,
      stage: "OPENAI_EXTRACTION",
      cacheKey: "requirements-v1",
      live,
      process,
      replayHandler: {
        functionName: "requirements:extract",
        args: { version: 1 },
      },
    });

    expect(result).toEqual({
      response: { providerId: "live-1" },
      mode: "live",
    });
    expect(live).toHaveBeenCalledOnce();
    expect(runMutation).toHaveBeenCalledTimes(4);
    expect(runMutation.mock.calls[2][1]).toEqual({
      projectId,
      scopeKey: projectId,
      stage: "OPENAI_EXTRACTION",
      cacheKey: "requirements-v1",
      response: { providerId: "live-1" },
      replayHandler: {
        functionName: "requirements:extract",
        args: { version: 1 },
      },
    });
    expect(process).toHaveBeenCalledWith(
      { providerId: "live-1" },
      {
        mode: "live",
        projectId,
        scopeKey: projectId,
        stage: "OPENAI_EXTRACTION",
        cacheKey: "requirements-v1",
      },
    );
  });

  it("skips live in replay mode and uses the identical processing callback", async () => {
    const cached = { providerId: "cached-1" };
    const { ctx, runMutation } = contextWithResults({
      mode: "replay",
      response: cached,
    });
    const live = vi.fn();
    const processedResponses: Array<{ providerId: string }> = [];

    const result = await callExternal<{ providerId: string }, string>(ctx, {
      projectId,
      stage: "DEVIN_BUILD_RESULT",
      live,
      replayHandler: { functionName: "builds:handleDevinResult" },
      process: (response) => {
        processedResponses.push(response);
        return response.providerId;
      },
    });

    expect(result).toBe("cached-1");
    expect(live).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledOnce();
    expect(processedResponses).toEqual([cached]);
  });

  it("supports pre-project scoped calls with the same attempt lifecycle", async () => {
    const { ctx, runMutation } = contextWithResults(
      { mode: "live" },
      {
        status: "acquired",
        attemptId: "attempt-scoped",
        idempotencyKey: "business-search:dubai:BUSINESS_SEARCH:v1",
        attemptNumber: 1,
        leaseExpiresAt: 1,
      },
      null,
      null,
    );
    const live = vi.fn().mockResolvedValue([{ name: "Demo Business" }]);

    const result = await callExternal(ctx, {
      scopeKey: "business-search:dubai",
      stage: "BUSINESS_SEARCH",
      version: "v1",
      live,
      replayHandler: { functionName: "businesses:searchBusinesses" },
    });

    expect(result).toEqual([{ name: "Demo Business" }]);
    expect(runMutation.mock.calls[0][1]).toEqual({
      projectId: undefined,
      scopeKey: "business-search:dubai",
      stage: "BUSINESS_SEARCH",
      cacheKey: "default",
    });
    expect(runMutation.mock.calls[2][1]).toMatchObject({
      projectId: undefined,
      scopeKey: "business-search:dubai",
      stage: "BUSINESS_SEARCH",
    });
  });

  it("does not cache failed live calls", async () => {
    const { ctx, runMutation } = contextWithResults(
      { mode: "live" },
      {
        status: "acquired",
        attemptId: "attempt-2",
        idempotencyKey: `${projectId}:FIREBASE_DEPLOY:default`,
        attemptNumber: 1,
        leaseExpiresAt: 1,
      },
      {
        status: "retry_scheduled",
        retryCount: 1,
        maxRetries: 3,
        nextRetryAt: 1,
      },
    );
    const failure = new Error("provider unavailable");

    await expect(
      callExternal(ctx, {
        projectId,
        stage: "FIREBASE_DEPLOY",
        live: async () => {
          throw failure;
        },
        replayHandler: { functionName: "deployments:deployFirebase" },
      }),
    ).rejects.toBe(failure);

    expect(runMutation).toHaveBeenCalledTimes(3);
  });
});
