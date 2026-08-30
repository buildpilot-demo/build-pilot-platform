// Mirrors PRIMARY_PROJECT_STATES from convex/stateMachine.ts (Section 8's
// primary state sequence, PROJECT_CREATED through DELIVERED). Duplicated
// here rather than imported so the admin app stays independent of the
// Convex backend's module graph, matching lib/types.ts's existing pattern.
export const PRIMARY_STAGES = [
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

// Which primary stage a given *_FAILED state was reached from, i.e. the
// furthest point in the pipeline the project got to before failing —
// mirrors the predecessor edges into each failure state in
// convex/stateMachine.ts's TRANSITIONS_BASE. Revision-loop failure states
// (REVISION_*_FAILED) aren't included: they never touch project.state.
const FAILURE_ANCHORS: Record<string, (typeof PRIMARY_STAGES)[number]> = {
  BUSINESS_SEARCH_FAILED: "PROJECT_CREATED",
  CALL_FAILED: "CALLING",
  TRANSCRIPT_FAILED: "CALL_COMPLETED",
  REQUIREMENTS_FAILED: "REQUIREMENTS_VALIDATING",
  DOCUMENT_GENERATION_FAILED: "DOCUMENTS_GENERATING",
  GITHUB_FAILED: "REPOSITORY_PREPARING",
  BUILD_VALIDATION_FAILED: "BUILD_VALIDATING",
  DEPLOYMENT_FAILED: "DEPLOYING",
  NOTIFICATION_FAILED: "NOTIFICATION_PENDING",
};

export type PipelineStatus = "active" | "failed" | "blocked" | "terminal";

export type PipelineProgress = {
  index: number;
  total: number;
  status: PipelineStatus;
};

function guessStageFromFailedStage(failedStage?: string): (typeof PRIMARY_STAGES)[number] | undefined {
  if (!failedStage) return undefined;
  const needle = failedStage.toUpperCase();
  return PRIMARY_STAGES.find((stage) => needle.includes(stage) || stage.includes(needle));
}

/** Resolves any project.state into a position along the primary pipeline, tagged with why. */
export function resolvePipelineProgress(state: string, failedStage?: string): PipelineProgress {
  const total = PRIMARY_STAGES.length;
  const primaryIndex = PRIMARY_STAGES.indexOf(state as (typeof PRIMARY_STAGES)[number]);
  if (primaryIndex !== -1) return { index: primaryIndex, total, status: "active" };

  const anchor = FAILURE_ANCHORS[state];
  if (anchor) return { index: PRIMARY_STAGES.indexOf(anchor), total, status: "failed" };

  if (state === "MANUAL_INTERVENTION_REQUIRED") {
    const guessed = guessStageFromFailedStage(failedStage);
    return { index: guessed ? PRIMARY_STAGES.indexOf(guessed) : 0, total, status: "blocked" };
  }

  // CANCELLED, or any other non-primary state we don't have a mapping for.
  return { index: 0, total, status: "terminal" };
}
