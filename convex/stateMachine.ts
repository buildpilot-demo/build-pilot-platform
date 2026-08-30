/**
 * ============================================================================
 * SHARED CONTRACT — read this before writing any state-changing Convex code.
 * ============================================================================
 *
 * `transitionProject` is the ONLY way any project or revision state may be
 * changed anywhere in this codebase (PRD docs/project-requirements.md
 * Section 8). Every stage function — regardless of who writes it — must
 * import this helper instead of patching `projects` / `workflowRuns` /
 * `revisionRequests` state fields directly:
 *
 *   import { transitionProject } from "./stateMachine";
 *
 *   await transitionProject(ctx, projectId, "CALLING", {
 *     stage: "VOICE_CALL",
 *     correlationId: project.correlationId,
 *   });
 *
 * Exact signature (frozen — see docs/task-plan.md Section 3, contract #2):
 *
 *   transitionProject(
 *     ctx: MutationCtx,
 *     projectId: Id<"projects">,
 *     toState: ProjectState,
 *     metadata: TransitionMetadata,   // { correlationId, stage, ...optional }
 *   ): Promise<void>
 *
 * `ctx` must be a mutation context (it calls `ctx.db.patch`/`ctx.db.insert`),
 * so this can only be called from inside a `mutation`/`internalMutation` (or
 * awaited from an `action` via `ctx.runMutation`) — never from a `query`.
 *
 * Behavior:
 *   1. Loads the current `projects` row for `projectId`. Throws if the
 *      project doesn't exist, or if `toState` is not reachable from the
 *      project's (or, for a revision, the RevisionRequest's) current state
 *      per the `TRANSITIONS` graph below — callers should let this
 *      propagate rather than catching and ignoring it.
 *   2. On success: patches `projects.state` (or, when `metadata
 *      .revisionRequestId` is supplied, `revisionRequests.status` instead —
 *      see "Revision transitions" below) and the linked `workflowRuns.state`,
 *      including failure metadata (`failedStage`, `errorCode`, `retryable`,
 *      `retryCount`, `maxRetries`, `provider`, `providerRequestId`) when
 *      `toState` is a failure state, and clearing that same metadata when
 *      leaving one.
 *   3. Always inserts one `activityEvents` row recording
 *      `{ fromState, toState, createdAt, correlationId, stage }` (plus any
 *      provider/errorCode/reason under `metadata`, when present) so the
 *      Admin dashboard has a complete, ordered audit trail per project.
 *
 * Revision transitions: pass `metadata.revisionRequestId` when `toState` is
 * one of `REVISION_STATES` (or its failure states). The RevisionRequest's
 * `workflowRuns` row is patched instead of the project's primary run, and
 * `revisionRequests.status` is patched instead of `projects.state` — the
 * project's own top-level `state` is left untouched during a revision cycle.
 *
 * The linked `workflowRuns` row is looked up (not stored on `projects`/
 * `revisionRequests`): the primary run is the row in `workflowRuns` for
 * this `projectId` with no `revisionRequestId` set; a revision's run is the
 * row with `revisionRequestId` equal to `metadata.revisionRequestId`. Both
 * must already exist (inserted by whoever created the project/revision —
 * e.g. `selectBusiness`, the revision-intake mutation) before the first
 * `transitionProject` call for that project/revision.
 *
 * Do NOT implement individual stage functions (voice calls, requirements
 * extraction, GitHub, Devin, deploy, WhatsApp, revisions, ...) in this file
 * — this module only owns the transition graph + the single helper above.
 * ============================================================================
 */

import { v, type Infer } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// State enum (PRD Section 8)
// ---------------------------------------------------------------------------

/** Primary project pipeline states, in pipeline order. */
export const PRIMARY_STATES = [
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

/** Revision states, per RevisionRequest, in pipeline order. */
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

/** Failure states (PRD Section 8 "Failure States"). */
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

/** The subset of FAILURE_STATES that belong to the revision loop (per RevisionRequest), rather than the primary project. */
const REVISION_FAILURE_STATES = new Set<string>([
  "REVISION_BUILD_FAILED",
  "REVISION_DEPLOYMENT_FAILED",
  "REVISION_NOTIFICATION_FAILED",
]);

/**
 * Generic terminal-until-admin-action state (Sections 9-11). Not one of the
 * three lists in Section 8 verbatim, but referenced throughout as the
 * landing state once retries are exhausted on any `*_FAILED` state.
 */
export const MANUAL_INTERVENTION_REQUIRED = "MANUAL_INTERVENTION_REQUIRED" as const;

export const ALL_STATES = [
  ...PRIMARY_STATES,
  ...REVISION_STATES,
  ...FAILURE_STATES,
  MANUAL_INTERVENTION_REQUIRED,
] as const;

export type ProjectState = (typeof ALL_STATES)[number];

/** Convex validator for `ProjectState` — reused by schema.ts. */
export const projectStateValidator = v.union(
  ...ALL_STATES.map((state) => v.literal(state)),
);
export type ProjectStateValidated = Infer<typeof projectStateValidator>;

const ALL_STATES_SET = new Set<string>(ALL_STATES);
const FAILURE_STATE_SET = new Set<string>([...FAILURE_STATES, MANUAL_INTERVENTION_REQUIRED]);
const REVISION_STATE_SET = new Set<string>(REVISION_STATES);

export function isFailureState(state: ProjectState): boolean {
  return FAILURE_STATE_SET.has(state);
}

/** True for states that live on a RevisionRequest rather than the project. */
export function isRevisionScopedState(state: ProjectState): boolean {
  return REVISION_STATE_SET.has(state) || REVISION_FAILURE_STATES.has(state);
}

// ---------------------------------------------------------------------------
// Transition graph (PRD Section 8 + Section 11 "Failure Recovery")
// ---------------------------------------------------------------------------

function chain(states: readonly ProjectState[]): Record<string, ProjectState[]> {
  const edges: Record<string, ProjectState[]> = {};
  states.forEach((state, index) => {
    edges[state] = index + 1 < states.length ? [states[index + 1]] : [];
  });
  return edges;
}

const primaryChain = chain(PRIMARY_STATES);
const revisionChain = chain(REVISION_STATES);

/**
 * `TRANSITIONS[state]` lists every state that is a legal direct successor of
 * `state`. `transitionProject` throws if `toState` is not in
 * `TRANSITIONS[fromState]`.
 *
 * `undefined` (a `projects`/`revisionRequests` row that has not yet been
 * bootstrapped into the state machine — no `state`/`status` value set) is
 * treated as a virtual predecessor of the two entry points,
 * `PROJECT_CREATED` and `REVISION_REQUESTED` — see `INITIAL_STATES`.
 */
export const TRANSITIONS: Readonly<Record<ProjectState, readonly ProjectState[]>> = {
  // --- Primary pipeline ---------------------------------------------------
  ...primaryChain,
  PROJECT_CREATED: [...primaryChain.PROJECT_CREATED],
  CALL_QUEUED: [...primaryChain.CALL_QUEUED, "CALL_FAILED"],
  CALLING: [...primaryChain.CALLING, "CALL_FAILED"],
  CALL_COMPLETED: [...primaryChain.CALL_COMPLETED, "TRANSCRIPT_FAILED"],
  TRANSCRIPT_RECEIVED: [...primaryChain.TRANSCRIPT_RECEIVED, "REQUIREMENTS_FAILED"],
  REQUIREMENTS_PROCESSING: [...primaryChain.REQUIREMENTS_PROCESSING, "REQUIREMENTS_FAILED"],
  REQUIREMENTS_READY: [...primaryChain.REQUIREMENTS_READY, "REQUIREMENTS_FAILED"],
  REQUIREMENTS_VALIDATING: [...primaryChain.REQUIREMENTS_VALIDATING, "REQUIREMENTS_FAILED"],
  REQUIREMENTS_VALIDATED: [...primaryChain.REQUIREMENTS_VALIDATED, "DOCUMENT_GENERATION_FAILED"],
  DOCUMENTS_GENERATING: [...primaryChain.DOCUMENTS_GENERATING, "DOCUMENT_GENERATION_FAILED"],
  DOCUMENTS_READY: [...primaryChain.DOCUMENTS_READY, "GITHUB_FAILED"],
  REPOSITORY_PREPARING: [...primaryChain.REPOSITORY_PREPARING, "GITHUB_FAILED"],
  REPOSITORY_READY: [...primaryChain.REPOSITORY_READY, "BUILD_VALIDATION_FAILED"],
  BUILD_QUEUED: [...primaryChain.BUILD_QUEUED, "BUILD_VALIDATION_FAILED"],
  DEVIN_BUILDING: [...primaryChain.DEVIN_BUILDING, "BUILD_VALIDATION_FAILED"],
  BUILD_VALIDATING: [...primaryChain.BUILD_VALIDATING, "BUILD_VALIDATION_FAILED"],
  BUILD_COMPLETED: [...primaryChain.BUILD_COMPLETED, "DEPLOYMENT_FAILED"],
  DEPLOYMENT_QUEUED: [...primaryChain.DEPLOYMENT_QUEUED, "DEPLOYMENT_FAILED"],
  DEPLOYING: [...primaryChain.DEPLOYING, "DEPLOYMENT_FAILED"],
  LIVE: [...primaryChain.LIVE, "NOTIFICATION_FAILED"],
  NOTIFICATION_PENDING: [...primaryChain.NOTIFICATION_PENDING, "NOTIFICATION_FAILED"],
  DELIVERED: [...primaryChain.DELIVERED],

  // --- Revision loop (per RevisionRequest) --------------------------------
  ...revisionChain,
  REVISION_REQUESTED: [...revisionChain.REVISION_REQUESTED],
  REVISION_ASSETS_RECEIVED: [...revisionChain.REVISION_ASSETS_RECEIVED, "REVISION_BUILD_FAILED"],
  REVISION_QUEUED: [...revisionChain.REVISION_QUEUED, "REVISION_BUILD_FAILED"],
  DEVIN_REVISING: [...revisionChain.DEVIN_REVISING, "REVISION_BUILD_FAILED"],
  REVISION_TESTING: [...revisionChain.REVISION_TESTING, "REVISION_BUILD_FAILED"],
  REVISION_DEPLOYING: [...revisionChain.REVISION_DEPLOYING, "REVISION_DEPLOYMENT_FAILED"],
  REVISION_LIVE: [...revisionChain.REVISION_LIVE, "REVISION_NOTIFICATION_FAILED"],
  REVISION_NOTIFICATION_PENDING: [
    ...revisionChain.REVISION_NOTIFICATION_PENDING,
    "REVISION_NOTIFICATION_FAILED",
  ],
  REVISION_COMPLETED: [...revisionChain.REVISION_COMPLETED],

  // --- Failure states ------------------------------------------------------
  // Section 11 "Failure Recovery": these four (+ CALL_FAILED,
  // REVISION_BUILD_FAILED) have a defined one-click resume target. Every
  // failure state can also always escalate to MANUAL_INTERVENTION_REQUIRED
  // once retries are exhausted or the error is non-retryable (Section 10).
  BUSINESS_SEARCH_FAILED: [MANUAL_INTERVENTION_REQUIRED],
  CALL_FAILED: ["CALL_QUEUED", MANUAL_INTERVENTION_REQUIRED],
  TRANSCRIPT_FAILED: [MANUAL_INTERVENTION_REQUIRED],
  REQUIREMENTS_FAILED: ["REQUIREMENTS_PROCESSING", MANUAL_INTERVENTION_REQUIRED],
  DOCUMENT_GENERATION_FAILED: [MANUAL_INTERVENTION_REQUIRED],
  GITHUB_FAILED: ["REPOSITORY_PREPARING", MANUAL_INTERVENTION_REQUIRED],
  BUILD_VALIDATION_FAILED: ["BUILD_QUEUED", MANUAL_INTERVENTION_REQUIRED],
  DEPLOYMENT_FAILED: ["DEPLOYMENT_QUEUED", MANUAL_INTERVENTION_REQUIRED],
  NOTIFICATION_FAILED: [MANUAL_INTERVENTION_REQUIRED],
  REVISION_BUILD_FAILED: ["REVISION_QUEUED", MANUAL_INTERVENTION_REQUIRED],
  REVISION_DEPLOYMENT_FAILED: [MANUAL_INTERVENTION_REQUIRED],
  REVISION_NOTIFICATION_FAILED: [MANUAL_INTERVENTION_REQUIRED],

  // Admin picks the concrete resume checkpoint (any primary/revision entry
  // point) once a human has resolved whatever needed manual attention.
  MANUAL_INTERVENTION_REQUIRED: [
    "CALL_QUEUED",
    "REQUIREMENTS_PROCESSING",
    "DOCUMENTS_GENERATING",
    "REPOSITORY_PREPARING",
    "BUILD_QUEUED",
    "DEPLOYMENT_QUEUED",
    "NOTIFICATION_PENDING",
    "REVISION_QUEUED",
  ],
};

/** Virtual entry points reachable from an unset (`undefined`) state/status. */
export const INITIAL_STATES: readonly ProjectState[] = ["PROJECT_CREATED", "REVISION_REQUESTED"];

function assertTransitionAllowed(
  fromState: ProjectState | undefined,
  toState: ProjectState,
): void {
  if (!ALL_STATES_SET.has(toState)) {
    throw new Error(`transitionProject: unknown state "${String(toState)}"`);
  }
  const allowed = fromState === undefined ? INITIAL_STATES : TRANSITIONS[fromState];
  if (!allowed.includes(toState)) {
    throw new Error(
      `transitionProject: illegal state transition ${fromState ?? "(unset)"} -> ${toState}`,
    );
  }
}

// ---------------------------------------------------------------------------
// transitionProject
// ---------------------------------------------------------------------------

export interface TransitionMetadata {
  /** Correlation ID stamped on the activityEvents row and on projects/workflowRuns/revisionRequests for this transition. */
  correlationId: string;
  /** Pipeline stage name this transition belongs to (e.g. "VOICE_CALL", "DEVIN_BUILD"). Recorded on activityEvents and, when entering a failure state, defaults `failedStage`. */
  stage: string;
  /** activityEvents.eventType override. Defaults to "STATE_TRANSITION". */
  eventType?: string;
  /** Free-text note for the audit trail (e.g. why an admin forced a transition). */
  reason?: string;

  // --- Failure metadata (Section 8 "Failure States") — required when
  // `toState` is a `*_FAILED` state or MANUAL_INTERVENTION_REQUIRED. ---
  failedStage?: string;
  errorCode?: string;
  retryable?: boolean;
  retryCount?: number;
  maxRetries?: number;
  provider?: string;
  providerRequestId?: string;

  /**
   * Required when `toState` is one of `REVISION_STATES` (or a revision
   * failure state): the transition targets this RevisionRequest's `status`
   * (and its linked `workflowRuns` row) instead of the project's primary
   * `state`.
   */
  revisionRequestId?: Id<"revisionRequests">;
}

function assertFailureMetadata(metadata: TransitionMetadata): void {
  const valid =
    (metadata.failedStage ?? metadata.stage) &&
    metadata.errorCode &&
    metadata.provider &&
    metadata.providerRequestId &&
    typeof metadata.retryable === "boolean" &&
    Number.isInteger(metadata.retryCount) &&
    Number.isInteger(metadata.maxRetries) &&
    (metadata.retryCount as number) >= 0 &&
    (metadata.maxRetries as number) >= 0;
  if (!valid) {
    throw new Error(
      "transitionProject: entering a failure state requires failedStage, errorCode, " +
        "retryable, retryCount, maxRetries, provider, and providerRequestId in metadata " +
        "(PRD Section 8 'Failure States')",
    );
  }
}

/**
 * The single entry point for changing a project's — or, via
 * `metadata.revisionRequestId`, a revision's — state. See the module-level
 * doc comment above for the full contract. Every Convex mutation/action
 * that moves a project through the pipeline MUST call this instead of
 * patching state fields directly.
 */
export async function transitionProject(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  toState: ProjectState,
  metadata: TransitionMetadata,
): Promise<void> {
  if (!metadata.correlationId || !metadata.stage) {
    throw new Error("transitionProject: metadata.correlationId and metadata.stage are required");
  }
  if (isFailureState(toState)) {
    assertFailureMetadata(metadata);
  }

  const project = await ctx.db.get(projectId);
  if (!project) {
    throw new Error(`transitionProject: project ${projectId} not found`);
  }

  const revisionRequestId = metadata.revisionRequestId;
  const revisionRequest = revisionRequestId ? await ctx.db.get(revisionRequestId) : null;
  if (revisionRequestId && (!revisionRequest || revisionRequest.projectId !== projectId)) {
    throw new Error(
      `transitionProject: revisionRequest ${revisionRequestId} does not belong to project ${projectId}`,
    );
  }

  const fromState = revisionRequest ? revisionRequest.status : project.state;
  assertTransitionAllowed(fromState, toState);

  const workflowRun = await findWorkflowRun(ctx, projectId, revisionRequestId);
  if (!workflowRun) {
    throw new Error(
      `transitionProject: no workflowRun found for ` +
        (revisionRequest ? `revisionRequest ${revisionRequestId}` : `project ${projectId}`),
    );
  }
  const workflowRunId = workflowRun._id;

  const now = Date.now();
  const entering = isFailureState(toState);
  const failureFields = entering
    ? {
        failedStage: metadata.failedStage ?? metadata.stage,
        errorCode: metadata.errorCode,
        retryable: metadata.retryable,
        retryCount: metadata.retryCount,
        maxRetries: metadata.maxRetries,
        provider: metadata.provider,
        providerRequestId: metadata.providerRequestId,
      }
    : {
        // Leaving a failure state on a successful transition — clear stale
        // failure metadata so a retried stage doesn't inherit it.
        failedStage: undefined,
        errorCode: undefined,
        retryable: undefined,
        retryCount: undefined,
        maxRetries: undefined,
        provider: undefined,
        providerRequestId: undefined,
      };

  if (revisionRequest) {
    await ctx.db.patch(revisionRequest._id, {
      status: toState,
      updatedAt: now,
      ...failureFields,
    });
  } else {
    await ctx.db.patch(projectId, {
      state: toState,
      updatedAt: now,
      ...failureFields,
    });
  }

  await ctx.db.patch(workflowRunId, {
    state: toState,
    updatedAt: now,
    ...failureFields,
  });

  // Full audit trail for the Admin dashboard.
  const extra: Record<string, unknown> = {};
  if (metadata.provider) extra.provider = metadata.provider;
  if (metadata.providerRequestId) extra.providerRequestId = metadata.providerRequestId;
  if (metadata.errorCode) extra.errorCode = metadata.errorCode;
  if (metadata.reason) extra.reason = metadata.reason;

  await ctx.db.insert("activityEvents", {
    projectId,
    workflowRunId,
    revisionRequestId,
    eventType: metadata.eventType ?? "STATE_TRANSITION",
    fromState,
    toState,
    stage: metadata.stage,
    correlationId: metadata.correlationId,
    createdAt: now,
    ...(Object.keys(extra).length > 0 ? { metadata: extra } : {}),
  });
}

async function findWorkflowRun(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  revisionRequestId: Id<"revisionRequests"> | undefined,
) {
  if (revisionRequestId !== undefined) {
    return await ctx.db
      .query("workflowRuns")
      .withIndex("by_revisionRequest", (q) => q.eq("revisionRequestId", revisionRequestId))
      .first();
  }
  const runs = await ctx.db
    .query("workflowRuns")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  return runs.find((run) => run.revisionRequestId === undefined) ?? null;
}
