import { describe, expect, it, vi } from "vitest";
import type { GenericId } from "convex/values";
import { replayLastResponse } from "../convex/lib/externalCall.js";

const projectId = "project-1" as GenericId<"projects">;

function handlerOf<T extends (...args: any[]) => any>(registered: unknown): T {
  return (registered as { _handler: T })._handler;
}

function context(options?: {
  authenticated?: boolean;
  state?: string;
  cached?: Record<string, unknown> | null;
}) {
  const inserted: Array<{ table: string; value: Record<string, unknown> }> = [];
  const scheduled: Array<Record<string, unknown>> = [];
  const cached = options?.cached === undefined
    ? {
        _id: "response-1",
        scopeKey: projectId,
        projectId,
        stage: "OPENAI_EXTRACTION",
        cacheKey: "default",
        response: { requirementId: "req-1" },
        replayHandler: {
          functionName: "requirements:extractRequirements",
          args: { source: "admin" },
        },
      }
    : options.cached;
  const query = {
    withIndex() { return this; },
    filter() { return this; },
    order() { return this; },
    async first() { return cached; },
  };
  return {
    ctx: {
      auth: {
        async getUserIdentity() {
          return options?.authenticated === false ? null : { subject: "admin-1" };
        },
      },
      db: {
        async get(table: string) {
          return table === "projects"
            ? { _id: projectId, state: options?.state ?? "MANUAL_INTERVENTION_REQUIRED" }
            : null;
        },
        query() { return query; },
        async insert(table: string, value: Record<string, unknown>) {
          inserted.push({ table, value });
          return "replay-request-1";
        },
      },
      scheduler: {
        async runAfter(_delay: number, _reference: unknown, args: Record<string, unknown>) {
          scheduled.push(args);
          return "scheduled-1";
        },
      },
    },
    inserted,
    scheduled,
  };
}

describe("replayLastResponse", () => {
  const replay = handlerOf(replayLastResponse);

  it("requires manual intervention state", async () => {
    const { ctx } = context({ state: "REQUIREMENTS_FAILED" });
    await expect(
      replay(ctx, { projectId, stage: "OPENAI_EXTRACTION" }),
    ).rejects.toThrow("MANUAL_INTERVENTION_REQUIRED");
  });

  it("rejects replay when no cached response exists", async () => {
    const { ctx } = context({ cached: null });
    await expect(
      replay(ctx, { projectId, stage: "OPENAI_EXTRACTION" }),
    ).rejects.toThrow("No successful response exists");
  });

  it("creates a replay request and schedules the original handler", async () => {
    const { ctx, inserted, scheduled } = context();
    const result = await replay(ctx, { projectId, stage: "OPENAI_EXTRACTION" });

    expect(result).toEqual({
      replayRequestId: "replay-request-1",
      scheduledFunctionId: "scheduled-1",
    });
    expect(inserted).toEqual([
      {
        table: "externalReplayRequests",
        value: {
          projectId,
          scopeKey: projectId,
          stage: "OPENAI_EXTRACTION",
          cacheKey: "default",
          status: "pending",
          requestedAt: expect.any(Number),
        },
      },
    ]);
    expect(scheduled).toEqual([{ source: "admin", projectId }]);
  });
});
