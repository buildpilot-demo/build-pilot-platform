import { expect, test } from "vitest";

import { adminForceProjectState, transitionProject } from "./stateMachine.js";

type ProjectId = Parameters<typeof transitionProject>[1];
type WorkflowRunId = NonNullable<Parameters<typeof transitionProject>[3]["workflowRunId"]>;
type RevisionRequestId = NonNullable<Parameters<typeof transitionProject>[3]["revisionRequestId"]>;

const projectId = "project-1" as ProjectId;
const workflowRunId = "workflow-1" as WorkflowRunId;
const revisionRequestId = "revision-1" as RevisionRequestId;

function createContext(options?: { projectState?: string; revisionStatus?: string }) {
  const records = new Map<string, Record<string, unknown>>([
    [
      projectId,
      {
        _id: projectId,
        state: options?.projectState ?? "CALL_QUEUED",
        workflowRunId,
      },
    ],
    [workflowRunId, { _id: workflowRunId, projectId, state: options?.projectState ?? "CALL_QUEUED" }],
    [
      revisionRequestId,
      {
        _id: revisionRequestId,
        projectId,
        workflowRunId,
        status: options?.revisionStatus ?? "REVISION_REQUESTED",
      },
    ],
  ]);
  const events: Record<string, unknown>[] = [];

  return {
    ctx: {
      db: {
        async get(_table: string, id: string) {
          return records.get(id) ?? null;
        },
        async patch(_table: string, id: string, value: Record<string, unknown>) {
          records.set(id, { ...records.get(id), ...value });
        },
        async insert(table: string, value: Record<string, unknown>) {
          expect(table).toBe("activityEvents");
          events.push(value);
          return "event-1";
        },
        query(table: string) {
          expect(table).toBe("activityEvents");
          return {
            withIndex(indexName: string, indexFn: (query: { eq(field: string, value: unknown): unknown }) => unknown) {
              expect(indexName).toBe("by_project_timestamp");
              let matchedProjectId: unknown;
              indexFn({
                eq(field: string, value: unknown) {
                  if (field === "projectId") matchedProjectId = value;
                  return this;
                },
              });
              const matches = events.filter((event) => event.projectId === matchedProjectId);
              return {
                order(_direction: "asc" | "desc") {
                  const sorted = [...matches].sort((a, b) => (b.timestamp as number) - (a.timestamp as number));
                  return {
                    async first() {
                      return (sorted[0] as { timestamp: number } | undefined) ?? null;
                    },
                  };
                },
              };
            },
          };
        },
      },
    },
    records,
    events,
  };
}

test("advances the project and workflow run and records an audit event", async () => {
  const { ctx, records, events } = createContext();

  await transitionProject(ctx, projectId, "CALLING", {
    correlationId: "correlation-1",
    stage: "voice-call",
  });

  expect(records.get(projectId)?.state).toBe("CALLING");
  expect(records.get(workflowRunId)?.state).toBe("CALLING");
  expect(events).toHaveLength(1);
  expect({ ...events[0], timestamp: 0 }).toEqual({
    projectId,
    workflowRunId,
    revisionRequestId: undefined,
    fromState: "CALL_QUEUED",
    toState: "CALLING",
    timestamp: 0,
    correlationId: "correlation-1",
    stage: "voice-call",
  });
  expect(typeof events[0].timestamp).toBe("number");
});

test("rejects an illegal transition without writing records", async () => {
  const { ctx, records, events } = createContext();

  await expect(
    transitionProject(ctx, projectId, "LIVE", {
      correlationId: "correlation-2",
      stage: "deployment",
    }),
  ).rejects.toThrow("Invalid project state transition: CALL_QUEUED -> LIVE");

  expect(records.get(projectId)?.state).toBe("CALL_QUEUED");
  expect(records.get(workflowRunId)?.state).toBe("CALL_QUEUED");
  expect(events).toHaveLength(0);
});

test("requires complete failure metadata", async () => {
  const { ctx, events } = createContext();

  await expect(
    transitionProject(ctx, projectId, "CALL_FAILED", {
      correlationId: "correlation-3",
      stage: "voice-call",
    }),
  ).rejects.toThrow("Failure transitions require");

  expect(events).toHaveLength(0);
});

test("stores required failure details on the project and workflow run", async () => {
  const { ctx, records, events } = createContext();

  await transitionProject(ctx, projectId, "CALL_FAILED", {
    correlationId: "correlation-failure",
    stage: "voice-call",
    failedStage: "CALLING",
    errorCode: "PROVIDER_TIMEOUT",
    retryable: true,
    retryCount: 1,
    maxRetries: 3,
    provider: "elevenlabs",
    providerRequestId: "request-1",
  });

  expect(records.get(projectId)).toMatchObject({
    state: "CALL_FAILED",
    failedStage: "CALLING",
    errorCode: "PROVIDER_TIMEOUT",
    retryable: true,
    retryCount: 1,
    maxRetries: 3,
    provider: "elevenlabs",
    providerRequestId: "request-1",
  });
  expect(records.get(workflowRunId)?.state).toBe("CALL_FAILED");
  expect(events[0]).toMatchObject({
    fromState: "CALL_QUEUED",
    toState: "CALL_FAILED",
    correlationId: "correlation-failure",
  });
});

test("moves exhausted stages to manual intervention with an audit event", async () => {
  const { ctx, records, events } = createContext();

  await transitionProject(ctx, projectId, "MANUAL_INTERVENTION_REQUIRED", {
    correlationId: "correlation-manual",
    stage: "voice-call",
    failedStage: "CALLING",
    errorCode: "RETRIES_EXHAUSTED",
    errorMessage: "Call retries exhausted",
    retryable: false,
    retryCount: 3,
    maxRetries: 3,
    provider: "elevenlabs",
    providerRequestId: "request-3",
  });

  expect(records.get(projectId)).toMatchObject({
    state: "MANUAL_INTERVENTION_REQUIRED",
    errorCode: "RETRIES_EXHAUSTED",
  });
  expect(records.get(workflowRunId)?.state).toBe("MANUAL_INTERVENTION_REQUIRED");
  expect(events[0]).toMatchObject({
    fromState: "CALL_QUEUED",
    toState: "MANUAL_INTERVENTION_REQUIRED",
    correlationId: "correlation-manual",
  });
});

test("updates a revision and its workflow without replacing the stable project state", async () => {
  const { ctx, records, events } = createContext({
    projectState: "DELIVERED",
    revisionStatus: "REVISION_REQUESTED",
  });

  await transitionProject(ctx, projectId, "REVISION_ASSETS_RECEIVED", {
    correlationId: "correlation-4",
    stage: "revision-intake",
    revisionRequestId,
  });

  expect(records.get(projectId)?.state).toBe("DELIVERED");
  expect(records.get(revisionRequestId)?.status).toBe("REVISION_ASSETS_RECEIVED");
  expect(records.get(workflowRunId)?.state).toBe("REVISION_ASSETS_RECEIVED");
  expect(events[0].revisionRequestId).toBe(revisionRequestId);
});

test("adminForceProjectState bypasses the transitions graph and clears failure metadata", async () => {
  const { ctx, records, events } = createContext({ projectState: "DEPLOYMENT_FAILED" });
  records.set(projectId, {
    ...records.get(projectId),
    failedStage: "DEPLOYING",
    errorCode: "FIREBASE_TIMEOUT",
    errorMessage: "Deployment timed out",
    retryable: true,
    retryCount: 2,
    maxRetries: 3,
  });
  records.set(workflowRunId, {
    ...records.get(workflowRunId),
    status: "failed",
    errorCode: "FIREBASE_TIMEOUT",
  });

  // DEPLOYMENT_FAILED -> CALL_QUEUED is not a legal edge in TRANSITIONS, but
  // an operator resuming from an earlier checkpoint must still be allowed.
  const result = await adminForceProjectState(ctx, projectId, "CALL_QUEUED", {
    correlationId: "correlation-resume",
    stage: "ADMIN_RESUME",
    reason: "Operator requested a full re-run",
  });

  expect(result.fromState).toBe("DEPLOYMENT_FAILED");
  expect(records.get(projectId)).toMatchObject({
    state: "CALL_QUEUED",
    failedStage: undefined,
    errorCode: undefined,
    errorMessage: undefined,
    retryable: undefined,
    retryCount: undefined,
    maxRetries: undefined,
  });
  expect(records.get(workflowRunId)).toMatchObject({
    state: "CALL_QUEUED",
    status: "active",
    errorCode: undefined,
  });
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    projectId,
    workflowRunId,
    eventType: "ADMIN_OVERRIDE",
    fromState: "DEPLOYMENT_FAILED",
    toState: "CALL_QUEUED",
    correlationId: "correlation-resume",
    stage: "ADMIN_RESUME",
    message: "Operator requested a full re-run",
  });
});

test("adminForceProjectState rejects unknown target states", async () => {
  const { ctx, events } = createContext();

  await expect(
    adminForceProjectState(ctx, projectId, "NOT_A_REAL_STATE" as Parameters<typeof transitionProject>[2], {
      correlationId: "correlation-invalid",
      stage: "ADMIN_RESUME",
    }),
  ).rejects.toThrow("Unknown project state");

  expect(events).toHaveLength(0);
});
