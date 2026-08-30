export const PRIMARY_PROJECT_STATES = [
  "PROJECT_CREATED",
  "CALL_QUEUED",
  "CALLING",
  "CALL_COMPLETED",
  "TRANSCRIPT_RECEIVED",
  "REQUIREMENTS_PROCESSING",
  "REQUIREMENTS_READY",
  "REQUIREMENTS_VALIDATING",
  "REQUIREMENTS_VALIDATED",
  "DOCUMENTS_GENERATING",
  "DOCUMENTS_READY",
  "REPOSITORY_PREPARING",
  "REPOSITORY_READY",
  "BUILD_QUEUED",
  "DEVIN_BUILDING",
  "BUILD_VALIDATING",
  "BUILD_COMPLETED",
  "DEPLOYMENT_QUEUED",
  "DEPLOYING",
  "LIVE",
  "NOTIFICATION_PENDING",
  "DELIVERED",
] as const;

export const REVISION_STATES = [
  "REVISION_REQUESTED",
  "REVISION_ASSETS_RECEIVED",
  "REVISION_QUEUED",
  "DEVIN_REVISING",
  "REVISION_TESTING",
  "REVISION_DEPLOYING",
  "REVISION_LIVE",
  "REVISION_NOTIFICATION_PENDING",
  "REVISION_COMPLETED",
] as const;

export const FAILURE_STATES = [
  "BUSINESS_SEARCH_FAILED",
  "CALL_FAILED",
  "TRANSCRIPT_FAILED",
  "REQUIREMENTS_FAILED",
  "DOCUMENT_GENERATION_FAILED",
  "GITHUB_FAILED",
  "BUILD_VALIDATION_FAILED",
  "DEPLOYMENT_FAILED",
  "NOTIFICATION_FAILED",
  "REVISION_BUILD_FAILED",
  "REVISION_DEPLOYMENT_FAILED",
  "REVISION_NOTIFICATION_FAILED",
] as const;

export const CONTROL_STATES = ["MANUAL_INTERVENTION_REQUIRED", "CANCELLED"] as const;

export const PROJECT_STATES = [
  ...PRIMARY_PROJECT_STATES,
  ...REVISION_STATES,
  ...FAILURE_STATES,
  ...CONTROL_STATES,
] as const;

export type PrimaryProjectState = (typeof PRIMARY_PROJECT_STATES)[number];
export type RevisionState = (typeof REVISION_STATES)[number];
export type FailureState = (typeof FAILURE_STATES)[number];
export type ControlState = (typeof CONTROL_STATES)[number];
export type ProjectState = (typeof PROJECT_STATES)[number];

type ProjectId = string & { readonly __tableName: "projects" };
type WorkflowRunId = string & { readonly __tableName: "workflowRuns" };
type RevisionRequestId = string & { readonly __tableName: "revisionRequests" };

type FailureMetadata = {
  failedStage: string;
  errorCode: string;
  errorMessage?: string;
  retryable: boolean;
  retryCount: number;
  maxRetries: number;
  provider: string;
  providerRequestId: string;
  lastAttemptAt?: number;
  nextRetryAt?: number;
};

export type TransitionMetadata = {
  correlationId: string;
  stage: string;
  workflowRunId?: WorkflowRunId;
  revisionRequestId?: RevisionRequestId;
} & Partial<FailureMetadata>;

type ProjectRecord = {
  _id: ProjectId;
  state: ProjectState;
  workflowRunId?: WorkflowRunId;
  createdAt: number;
};

type WorkflowRunRecord = {
  _id: WorkflowRunId;
  projectId: ProjectId;
};

type RevisionRequestRecord = {
  _id: RevisionRequestId;
  projectId: ProjectId;
  status: RevisionState | Extract<FailureState, `REVISION_${string}_FAILED`>;
  workflowRunId?: WorkflowRunId;
};

type StateMachineDb = {
  get(table: "projects", id: ProjectId): Promise<ProjectRecord | null>;
  get(table: "workflowRuns", id: WorkflowRunId): Promise<WorkflowRunRecord | null>;
  get(table: "revisionRequests", id: RevisionRequestId): Promise<RevisionRequestRecord | null>;
  patch(
    table: "projects" | "workflowRuns" | "revisionRequests",
    id: ProjectId | WorkflowRunId | RevisionRequestId,
    value: Record<string, unknown>,
  ): Promise<void>;
  insert(table: "activityEvents", value: Record<string, unknown>): Promise<unknown>;
  query(table: "activityEvents"): {
    withIndex(
      indexName: "by_project_timestamp",
      indexFn: (q: { eq(field: string, value: unknown): unknown }) => unknown,
    ): { order(direction: "asc" | "desc"): { first(): Promise<{ timestamp: number } | null> } };
  };
};

export type StateMachineContext = { db: unknown };

// How long this transition took after the project's previous activityEvents
// row (any stage/type, most recent by timestamp) — undefined for a
// project's very first event, which has no predecessor to measure from.
async function elapsedSincePreviousEvent(db: StateMachineDb, projectId: ProjectId, timestamp: number): Promise<number | undefined> {
  const previous = await db
    .query("activityEvents")
    .withIndex("by_project_timestamp", (query) => query.eq("projectId", projectId))
    .order("desc")
    .first();
  return previous ? timestamp - previous.timestamp : undefined;
}

const primaryTransitions = consecutiveTransitions(PRIMARY_PROJECT_STATES);
const revisionTransitions = consecutiveTransitions(REVISION_STATES);

const TRANSITIONS_BASE: Readonly<
  Record<Exclude<ProjectState, ControlState>, readonly ProjectState[]>
> = {
  ...primaryTransitions,
  ...revisionTransitions,
  PROJECT_CREATED: [...primaryTransitions.PROJECT_CREATED, "BUSINESS_SEARCH_FAILED"],
  CALL_QUEUED: [...primaryTransitions.CALL_QUEUED, "CALL_FAILED"],
  CALLING: [...primaryTransitions.CALLING, "CALL_FAILED"],
  CALL_COMPLETED: [...primaryTransitions.CALL_COMPLETED, "TRANSCRIPT_FAILED"],
  TRANSCRIPT_RECEIVED: [...primaryTransitions.TRANSCRIPT_RECEIVED, "REQUIREMENTS_FAILED"],
  REQUIREMENTS_PROCESSING: [...primaryTransitions.REQUIREMENTS_PROCESSING, "REQUIREMENTS_FAILED"],
  REQUIREMENTS_READY: [...primaryTransitions.REQUIREMENTS_READY, "REQUIREMENTS_FAILED"],
  REQUIREMENTS_VALIDATING: [...primaryTransitions.REQUIREMENTS_VALIDATING, "REQUIREMENTS_FAILED"],
  REQUIREMENTS_VALIDATED: [...primaryTransitions.REQUIREMENTS_VALIDATED, "DOCUMENT_GENERATION_FAILED"],
  DOCUMENTS_GENERATING: [...primaryTransitions.DOCUMENTS_GENERATING, "DOCUMENT_GENERATION_FAILED"],
  DOCUMENTS_READY: [...primaryTransitions.DOCUMENTS_READY, "GITHUB_FAILED"],
  REPOSITORY_PREPARING: [...primaryTransitions.REPOSITORY_PREPARING, "GITHUB_FAILED"],
  REPOSITORY_READY: [...primaryTransitions.REPOSITORY_READY, "BUILD_VALIDATION_FAILED"],
  BUILD_QUEUED: [...primaryTransitions.BUILD_QUEUED, "BUILD_VALIDATION_FAILED"],
  DEVIN_BUILDING: [...primaryTransitions.DEVIN_BUILDING, "BUILD_VALIDATION_FAILED"],
  BUILD_VALIDATING: [...primaryTransitions.BUILD_VALIDATING, "BUILD_VALIDATION_FAILED"],
  BUILD_COMPLETED: [...primaryTransitions.BUILD_COMPLETED, "DEPLOYMENT_FAILED"],
  DEPLOYMENT_QUEUED: [...primaryTransitions.DEPLOYMENT_QUEUED, "DEPLOYMENT_FAILED"],
  DEPLOYING: [...primaryTransitions.DEPLOYING, "DEPLOYMENT_FAILED"],
  LIVE: [...primaryTransitions.LIVE, "NOTIFICATION_FAILED"],
  NOTIFICATION_PENDING: [...primaryTransitions.NOTIFICATION_PENDING, "NOTIFICATION_FAILED"],
  REVISION_ASSETS_RECEIVED: [...revisionTransitions.REVISION_ASSETS_RECEIVED, "REVISION_BUILD_FAILED"],
  REVISION_QUEUED: [...revisionTransitions.REVISION_QUEUED, "REVISION_BUILD_FAILED"],
  DEVIN_REVISING: [...revisionTransitions.DEVIN_REVISING, "REVISION_BUILD_FAILED"],
  REVISION_TESTING: [
    ...revisionTransitions.REVISION_TESTING,
    "REVISION_BUILD_FAILED",
    "REVISION_DEPLOYMENT_FAILED",
  ],
  REVISION_DEPLOYING: [...revisionTransitions.REVISION_DEPLOYING, "REVISION_DEPLOYMENT_FAILED"],
  REVISION_LIVE: [...revisionTransitions.REVISION_LIVE, "REVISION_NOTIFICATION_FAILED"],
  REVISION_NOTIFICATION_PENDING: [
    ...revisionTransitions.REVISION_NOTIFICATION_PENDING,
    "REVISION_NOTIFICATION_FAILED",
  ],
  BUSINESS_SEARCH_FAILED: [],
  CALL_FAILED: ["CALL_QUEUED"],
  TRANSCRIPT_FAILED: [],
  REQUIREMENTS_FAILED: ["REQUIREMENTS_PROCESSING"],
  DOCUMENT_GENERATION_FAILED: [],
  GITHUB_FAILED: ["REPOSITORY_PREPARING"],
  BUILD_VALIDATION_FAILED: ["BUILD_QUEUED"],
  DEPLOYMENT_FAILED: ["DEPLOYMENT_QUEUED"],
  NOTIFICATION_FAILED: [],
  REVISION_BUILD_FAILED: ["REVISION_QUEUED"],
  REVISION_DEPLOYMENT_FAILED: [],
  REVISION_NOTIFICATION_FAILED: [],
};

const manualRecoveryStates: readonly ProjectState[] = [
  "CALL_QUEUED",
  "REQUIREMENTS_PROCESSING",
  "REPOSITORY_PREPARING",
  "BUILD_QUEUED",
  "DEPLOYMENT_QUEUED",
  "NOTIFICATION_PENDING",
  "REVISION_QUEUED",
];

const TRANSITIONS = Object.fromEntries(
  PROJECT_STATES.map((state) => {
    if (state === "MANUAL_INTERVENTION_REQUIRED") return [state, manualRecoveryStates];
    if (state === "CANCELLED") return [state, []];
    return [state, [...TRANSITIONS_BASE[state], "MANUAL_INTERVENTION_REQUIRED", "CANCELLED"]];
  }),
) as Readonly<Record<ProjectState, readonly ProjectState[]>>;

const projectStates = new Set<string>(PROJECT_STATES);
const revisionStates = new Set<string>(REVISION_STATES);
const revisionFailureStates = new Set<string>([
  "REVISION_BUILD_FAILED",
  "REVISION_DEPLOYMENT_FAILED",
  "REVISION_NOTIFICATION_FAILED",
]);
const failureStates = new Set<string>(FAILURE_STATES);

function consecutiveTransitions<const T extends readonly ProjectState[]>(states: T) {
  return Object.fromEntries(
    states.map((state, index) => [state, index + 1 < states.length ? [states[index + 1]] : []]),
  ) as unknown as { [State in T[number]]: readonly ProjectState[] };
}

function assertFailureMetadata(metadata: TransitionMetadata): asserts metadata is TransitionMetadata & FailureMetadata {
  if (
    !metadata.failedStage ||
    !metadata.errorCode ||
    !metadata.provider ||
    !metadata.providerRequestId ||
    typeof metadata.retryable !== "boolean" ||
    !Number.isInteger(metadata.retryCount) ||
    !Number.isInteger(metadata.maxRetries) ||
    metadata.retryCount! < 0 ||
    metadata.maxRetries! < 0
  ) {
    throw new Error(
      "Failure transitions require failedStage, errorCode, retryable, retryCount, maxRetries, provider, and providerRequestId metadata",
    );
  }
}

function assertTransitionAllowed(fromState: ProjectState, toState: ProjectState) {
  if (!TRANSITIONS[fromState].includes(toState)) {
    throw new Error(`Invalid project state transition: ${fromState} -> ${toState}`);
  }
}

export type AdminResumeMetadata = {
  correlationId: string;
  stage: string;
  reason?: string;
  workflowRunId?: WorkflowRunId;
};

/**
 * Admin-only override used exclusively by the Admin app's "Resume from
 * step" / "Retry" controls (convex/adminRecovery.ts, convex/retryActions.ts)
 * — never called from automated pipeline code. Unlike transitionProject,
 * this intentionally does NOT enforce the TRANSITIONS adjacency graph: an
 * operator may need to resume a project from any earlier checkpoint (e.g.
 * re-run the voice call after a downstream build failure) which the
 * strict forward-only state machine deliberately disallows on its own.
 *
 * Every call is still fully audited (an activityEvents row with
 * eventType "ADMIN_OVERRIDE" is written) and clears any stale failure
 * metadata on the project + workflow run so the resumed stage doesn't
 * inherit a previous attempt's error fields.
 */
export async function adminForceProjectState(
  ctx: StateMachineContext,
  projectId: ProjectId,
  toState: ProjectState,
  metadata: AdminResumeMetadata,
): Promise<{ fromState: ProjectState; workflowRunId: WorkflowRunId }> {
  if (!projectStates.has(toState)) {
    throw new Error(`Unknown project state: ${String(toState)}`);
  }
  if (!metadata.correlationId || !metadata.stage) {
    throw new Error("Admin resume requires correlationId and stage metadata");
  }

  const db = ctx.db as StateMachineDb;
  const project = await db.get("projects", projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  const workflowRunId = metadata.workflowRunId ?? project.workflowRunId;
  if (!workflowRunId) {
    throw new Error(`No workflow run is linked to project ${projectId}`);
  }
  const workflowRun = await db.get("workflowRuns", workflowRunId);
  if (!workflowRun || workflowRun.projectId !== projectId) {
    throw new Error(`Workflow run ${workflowRunId} does not belong to project ${projectId}`);
  }

  const fromState = project.state;
  const timestamp = Date.now();
  const elapsedMs = await elapsedSincePreviousEvent(db, projectId, timestamp);
  const clearedFailureFields = {
    failedStage: undefined,
    errorCode: undefined,
    errorMessage: undefined,
    retryable: undefined,
    retryCount: undefined,
    maxRetries: undefined,
    lastAttemptAt: undefined,
    nextRetryAt: undefined,
  };

  await db.patch("projects", projectId, {
    state: toState,
    updatedAt: timestamp,
    totalDurationMs: timestamp - project.createdAt,
    ...clearedFailureFields,
  });
  await db.patch("workflowRuns", workflowRunId, {
    state: toState,
    status: "active",
    updatedAt: timestamp,
    ...clearedFailureFields,
  });
  await db.insert("activityEvents", {
    projectId,
    workflowRunId,
    eventType: "ADMIN_OVERRIDE",
    fromState,
    toState,
    timestamp,
    elapsedMs,
    correlationId: metadata.correlationId,
    stage: metadata.stage,
    message: metadata.reason ?? `Operator resumed the workflow at ${toState}`,
  });

  return { fromState, workflowRunId };
}

/**
 * The only supported state-write API for Convex workflow code.
 *
 * Exact shared signature:
 * transitionProject(ctx, projectId, toState, metadata): Promise<void>
 *
 * Revision transitions require metadata.revisionRequestId and update that
 * revision request plus its workflow run; the stable primary project state is
 * left unchanged.
 */
export async function transitionProject(
  ctx: StateMachineContext,
  projectId: ProjectId,
  toState: ProjectState,
  metadata: TransitionMetadata,
): Promise<void> {
  if (!projectStates.has(toState)) {
    throw new Error(`Unknown project state: ${String(toState)}`);
  }
  if (!metadata.correlationId || !metadata.stage) {
    throw new Error("State transitions require correlationId and stage metadata");
  }
  const isFailureTarget =
    failureStates.has(toState) || toState === "MANUAL_INTERVENTION_REQUIRED";
  if (isFailureTarget) {
    assertFailureMetadata(metadata);
  }

  const db = ctx.db as StateMachineDb;
  const project = await db.get("projects", projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const isRevisionTransition = revisionStates.has(toState) || revisionFailureStates.has(toState);
  let fromState: ProjectState;
  let workflowRunId = metadata.workflowRunId ?? project.workflowRunId;
  let revisionRequest: RevisionRequestRecord | null = null;

  if (isRevisionTransition) {
    if (!metadata.revisionRequestId) {
      throw new Error(`Transition to ${toState} requires metadata.revisionRequestId`);
    }
    revisionRequest = await db.get("revisionRequests", metadata.revisionRequestId);
    if (!revisionRequest || revisionRequest.projectId !== projectId) {
      throw new Error(`Revision request ${metadata.revisionRequestId} does not belong to project ${projectId}`);
    }
    fromState = revisionRequest.status;
    workflowRunId = metadata.workflowRunId ?? revisionRequest.workflowRunId;
  } else {
    fromState = project.state;
  }

  assertTransitionAllowed(fromState, toState);

  if (!workflowRunId) {
    throw new Error(`No workflow run is linked to transition ${fromState} -> ${toState}`);
  }
  const workflowRun = await db.get("workflowRuns", workflowRunId);
  if (!workflowRun || workflowRun.projectId !== projectId) {
    throw new Error(`Workflow run ${workflowRunId} does not belong to project ${projectId}`);
  }

  const failurePatch = isFailureTarget
    ? {
        failedStage: metadata.failedStage,
        errorCode: metadata.errorCode,
        errorMessage: metadata.errorMessage,
        retryable: metadata.retryable,
        retryCount: metadata.retryCount,
        maxRetries: metadata.maxRetries,
        correlationId: metadata.correlationId,
        provider: metadata.provider,
        providerRequestId: metadata.providerRequestId,
        lastAttemptAt: metadata.lastAttemptAt,
        nextRetryAt: metadata.nextRetryAt,
      }
    : {};

  const timestamp = Date.now();
  const elapsedMs = await elapsedSincePreviousEvent(db, projectId, timestamp);
  if (revisionRequest) {
    await db.patch("revisionRequests", revisionRequest._id, {
      status: toState,
      updatedAt: timestamp,
      ...failurePatch,
    });
  } else {
    await db.patch("projects", projectId, {
      state: toState,
      updatedAt: timestamp,
      totalDurationMs: timestamp - project.createdAt,
      ...failurePatch,
    });
  }
  await db.patch("workflowRuns", workflowRunId, {
    state: toState,
    updatedAt: timestamp,
    ...failurePatch,
  });
  await db.insert("activityEvents", {
    projectId,
    workflowRunId,
    revisionRequestId: revisionRequest?._id,
    fromState,
    elapsedMs,
    toState,
    timestamp,
    correlationId: metadata.correlationId,
    stage: metadata.stage,
    ...(metadata.provider ? { provider: metadata.provider } : {}),
    ...(metadata.providerRequestId ? { providerRequestId: metadata.providerRequestId } : {}),
    ...(metadata.errorCode ? { errorCode: metadata.errorCode } : {}),
  });
}
