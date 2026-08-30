// Mirrors RESUMABLE_CHECKPOINTS from convex/adminRecovery.ts (kept in sync
// by hand, matching lib/pipeline.ts and lib/failureRecovery.ts's existing
// pattern of duplicating backend constants so the admin app stays
// independent of the Convex backend's module graph). This is the generic
// "resume from any step" list — unlike lib/failureRecovery.ts, it applies
// to every project regardless of which specific stage failed (or whether it
// failed at all), which is what lets an operator resume/retry from any
// checkpoint in the workflow, not just the handful of stages with a
// dedicated retry button.
export const RESUMABLE_CHECKPOINTS: ReadonlyArray<{ state: string; label: string }> = [
  { state: "PROJECT_CREATED", label: "Restart from business selection (new call)" },
  { state: "CALL_QUEUED", label: "Retry voice call" },
  { state: "REQUIREMENTS_PROCESSING", label: "Retry requirement extraction" },
  { state: "DOCUMENTS_GENERATING", label: "Retry document generation" },
  { state: "REPOSITORY_PREPARING", label: "Retry repository preparation" },
  { state: "BUILD_QUEUED", label: "Retry Devin build" },
  { state: "DEPLOYMENT_QUEUED", label: "Retry Firebase deployment" },
  { state: "NOTIFICATION_PENDING", label: "Retry WhatsApp delivery" },
];

// Maps every project.state (in-progress, failed, or otherwise idle) to the
// resumable checkpoint that would carry the pipeline forward from there —
// backs the single-click "Resume" button on the pipeline/progress view
// (as opposed to the failure panel's dropdown, which lets an operator pick
// any checkpoint explicitly). Terminal states (DELIVERED, CANCELLED) and
// MANUAL_INTERVENTION_REQUIRED (whose failed stage isn't state-determined —
// see lib/failureRecovery.ts) intentionally have no entry here.
const NEXT_CHECKPOINT: Record<string, string> = {
  PROJECT_CREATED: "CALL_QUEUED",
  CALL_QUEUED: "CALL_QUEUED",
  CALLING: "CALL_QUEUED",
  CALL_FAILED: "CALL_QUEUED",
  BUSINESS_SEARCH_FAILED: "CALL_QUEUED",
  CALL_COMPLETED: "REQUIREMENTS_PROCESSING",
  TRANSCRIPT_RECEIVED: "REQUIREMENTS_PROCESSING",
  TRANSCRIPT_FAILED: "CALL_QUEUED",
  REQUIREMENTS_PROCESSING: "REQUIREMENTS_PROCESSING",
  REQUIREMENTS_FAILED: "REQUIREMENTS_PROCESSING",
  REQUIREMENTS_READY: "DOCUMENTS_GENERATING",
  REQUIREMENTS_VALIDATING: "DOCUMENTS_GENERATING",
  REQUIREMENTS_VALIDATED: "DOCUMENTS_GENERATING",
  DOCUMENTS_GENERATING: "DOCUMENTS_GENERATING",
  DOCUMENT_GENERATION_FAILED: "DOCUMENTS_GENERATING",
  DOCUMENTS_READY: "REPOSITORY_PREPARING",
  REPOSITORY_PREPARING: "REPOSITORY_PREPARING",
  GITHUB_FAILED: "REPOSITORY_PREPARING",
  REPOSITORY_READY: "BUILD_QUEUED",
  BUILD_QUEUED: "BUILD_QUEUED",
  DEVIN_BUILDING: "BUILD_QUEUED",
  BUILD_VALIDATING: "BUILD_QUEUED",
  BUILD_VALIDATION_FAILED: "BUILD_QUEUED",
  BUILD_COMPLETED: "DEPLOYMENT_QUEUED",
  DEPLOYMENT_QUEUED: "DEPLOYMENT_QUEUED",
  DEPLOYING: "DEPLOYMENT_QUEUED",
  DEPLOYMENT_FAILED: "DEPLOYMENT_QUEUED",
  LIVE: "NOTIFICATION_PENDING",
  NOTIFICATION_PENDING: "NOTIFICATION_PENDING",
  NOTIFICATION_FAILED: "NOTIFICATION_PENDING",
};

export function resolveNextCheckpoint(state?: string): string | undefined {
  return state ? NEXT_CHECKPOINT[state] : undefined;
}
