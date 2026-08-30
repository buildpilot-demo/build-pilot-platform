import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenericId } from "convex/values";
import {
  beginStageAttemptMutation,
  boundedExponentialBackoff,
  claimReconciliationMutation,
  completeStageAttemptMutation,
  failStageAttemptMutation,
  finalizeReconciliationMutation,
  stageIdempotencyKey,
} from "../convex/lib/stageAttempt.js";

type RecordValue = Record<string, any>;

const projectId = "project-1" as GenericId<"projects">;
const workflowRunId = "workflow-1" as GenericId<"workflowRuns">;
const attemptId = "attempt-1" as GenericId<"stageAttempts">;

function handlerOf<T extends (...args: any[]) => any>(registered: unknown): T {
  return (registered as { _handler: T })._handler;
}

function createContext(initialAttempts: RecordValue[] = []) {
  let nextAttempt = initialAttempts.length + 1;
  const tables = {
    projects: new Map<string, RecordValue>([
      [projectId, { _id: projectId, state: "CALLING", workflowRunId, createdAt: 0 }],
    ]),
    workflowRuns: new Map<string, RecordValue>([
      [workflowRunId, { _id: workflowRunId, projectId, state: "CALLING" }],
    ]),
    stageAttempts: new Map<string, RecordValue>(
      initialAttempts.map((attempt) => [attempt._id, attempt]),
    ),
    activityEvents: new Map<string, RecordValue>(),
  };

  const db = {
    async get(table: keyof typeof tables, id: string) {
      return tables[table].get(id) ?? null;
    },
    query(table: keyof typeof tables) {
      let predicate: ((record: RecordValue) => boolean) | undefined;
      return {
        withIndex(_indexName?: string, indexFn?: (query: { eq(field: string, value: unknown): unknown }) => unknown) {
          if (indexFn) {
            indexFn({
              eq(field: string, value: unknown) {
                predicate = (record) => record[field] === value;
                return this;
              },
            });
          }
          return this;
        },
        filter() {
          return this;
        },
        order() {
          return this;
        },
        async collect() {
          return [...tables[table].values()].reverse();
        },
        // Only used by stateMachine.ts's elapsedSincePreviousEvent, which
        // reads the most recent activityEvents row (by timestamp) for the
        // withIndex-scoped projectId.
        async first() {
          const rows = [...tables[table].values()];
          const scoped = predicate ? rows.filter(predicate) : rows;
          const sorted = [...scoped].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
          return sorted[0] ?? null;
        },
      };
    },
    async insert(table: keyof typeof tables, value: RecordValue) {
      const id =
        table === "stageAttempts"
          ? (`attempt-${nextAttempt++}` as GenericId<"stageAttempts">)
          : (`event-${tables.activityEvents.size + 1}` as GenericId<"activityEvents">);
      tables[table].set(id, { _id: id, ...value });
      return id;
    },
    async patch(table: keyof typeof tables, id: string, value: RecordValue) {
      const existing = tables[table].get(id);
      if (!existing) throw new Error(`Missing ${table}:${id}`);
      const next = { ...existing, ...value };
      for (const [key, field] of Object.entries(next)) {
        if (field === undefined) delete next[key];
      }
      tables[table].set(id, next);
    },
  };

  return { ctx: { db }, tables };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("stage attempt lifecycle", () => {
  it("acquires one lease and rejects another in-flight claim", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const { ctx } = createContext();
    const begin = handlerOf(beginStageAttemptMutation);

    const acquired = await begin(ctx, {
      projectId,
      stage: "ELEVENLABS_CALL",
      version: "v1",
    });
    const conflict = await begin(ctx, {
      projectId,
      stage: "ELEVENLABS_CALL",
      version: "v1",
    });

    expect(acquired).toMatchObject({
      status: "acquired",
      idempotencyKey: `${projectId}:ELEVENLABS_CALL:v1`,
      attemptNumber: 1,
    });
    expect(conflict).toMatchObject({ status: "lease_conflict" });
  });

  it("acquires a scoped lease before a project exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(15_000);
    const { ctx, tables } = createContext();
    const begin = handlerOf(beginStageAttemptMutation);

    const acquired = await begin(ctx, {
      scopeKey: "business-search:dubai",
      stage: "BUSINESS_SEARCH",
      version: "v1",
    });

    expect(acquired).toMatchObject({
      status: "acquired",
      idempotencyKey: "business-search:dubai:BUSINESS_SEARCH:v1",
    });
    expect([...tables.stageAttempts.values()][0]).toMatchObject({
      scopeKey: "business-search:dubai",
      projectId: undefined,
    });
  });

  it("returns a completed attempt instead of inserting a duplicate", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    const { ctx, tables } = createContext();
    const begin = handlerOf(beginStageAttemptMutation);
    const complete = handlerOf(completeStageAttemptMutation);

    const acquired = await begin(ctx, {
      projectId,
      stage: "OPENAI_EXTRACTION",
      version: 2,
    });
    await complete(ctx, {
      attemptId: acquired.attemptId,
      result: { requirementId: "requirements-1" },
    });
    const reused = await begin(ctx, {
      projectId,
      stage: "OPENAI_EXTRACTION",
      version: 2,
    });

    expect(reused).toMatchObject({
      status: "completed",
      attemptId: acquired.attemptId,
      result: { requirementId: "requirements-1" },
    });
    expect(tables.stageAttempts).toHaveLength(1);
  });

  it("reconciles an expired attempt before allowing replacement", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(30_000);
    const idempotencyKey = stageIdempotencyKey(projectId, "DEVIN_BUILD", "v1");
    const { ctx, tables } = createContext([
      {
        _id: attemptId,
        projectId,
        workflowRunId,
        stage: "DEVIN_BUILD",
        version: "v1",
        idempotencyKey,
        attemptNumber: 1,
        status: "in_progress",
        leaseExpiresAt: 29_000,
        providerRequestId: "devin-session-1",
      },
    ]);
    const claim = handlerOf(claimReconciliationMutation);
    const finalize = handlerOf(finalizeReconciliationMutation);

    const claimed = await claim(ctx, {
      projectId,
      stage: "DEVIN_BUILD",
      version: "v1",
    });
    expect(claimed).toMatchObject({
      status: "claimed",
      attempt: { providerRequestId: "devin-session-1" },
    });

    const reconciled = await finalize(ctx, {
      attemptId,
      reconciliationToken: claimed.reconciliationToken,
      outcome: { status: "succeeded", result: { commitSha: "abc123" } },
    });
    expect(reconciled).toMatchObject({ status: "completed", attemptId });
    expect(tables.stageAttempts.get(attemptId)).toMatchObject({
      status: "completed",
      result: { commitSha: "abc123" },
    });
  });

  it("schedules retryable failures and audits terminal failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(40_000);
    const idempotencyKey = stageIdempotencyKey(projectId, "FIREBASE_DEPLOY", "v1");
    const retryAttempt = {
      _id: attemptId,
      projectId,
      workflowRunId,
      stage: "FIREBASE_DEPLOY",
      version: "v1",
      idempotencyKey,
      attemptNumber: 1,
      status: "in_progress",
      leaseExpiresAt: 50_000,
    };
    const retryContext = createContext([retryAttempt]);
    const fail = handlerOf(failStageAttemptMutation);

    const retry = await fail(retryContext.ctx, {
      attemptId,
      error: {
        errorCode: "PROVIDER_TIMEOUT",
        message: "Firebase did not respond",
        retryable: true,
        maxRetries: 3,
      },
    });
    expect(retry).toMatchObject({
      status: "retry_scheduled",
      retryCount: 1,
      maxRetries: 3,
    });
    expect(retry.nextRetryAt).toBeGreaterThan(40_000);

    const terminalContext = createContext([{ ...retryAttempt, status: "in_progress" }]);
    const terminal = await fail(terminalContext.ctx, {
      attemptId,
      error: {
        errorCode: "INVALID_CREDENTIALS",
        message: "Firebase rejected the credentials",
        retryable: false,
        provider: "firebase",
        correlationId: "correlation-1",
      },
    });
    expect(terminal.status).toBe("manual_intervention_required");
    expect(terminalContext.tables.projects.get(projectId)).toMatchObject({
      state: "MANUAL_INTERVENTION_REQUIRED",
      failedStage: "FIREBASE_DEPLOY",
      errorCode: "INVALID_CREDENTIALS",
    });
    expect([...terminalContext.tables.activityEvents.values()][0]).toMatchObject({
      toState: "MANUAL_INTERVENTION_REQUIRED",
      correlationId: "correlation-1",
    });
  });
});

describe("boundedExponentialBackoff", () => {
  it("caps exponential growth and applies bounded jitter", () => {
    expect(
      boundedExponentialBackoff(1, {
        baseDelayMs: 1_000,
        maxDelayMs: 4_000,
        jitterRatio: 0.2,
        random: () => 0,
      }),
    ).toBe(800);
    expect(
      boundedExponentialBackoff(10, {
        baseDelayMs: 1_000,
        maxDelayMs: 4_000,
        jitterRatio: 0.2,
        random: () => 1,
      }),
    ).toBe(4_000);
  });
});
