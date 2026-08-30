// Section 11's Failure Recovery table: which admin action resumes a project
// from a given failed stage, and which primary state it resumes into.
export type RecoveryKind = "CALL_FAILED" | "REQUIREMENTS_FAILED" | "GITHUB_FAILED" | "BUILD_VALIDATION_FAILED" | "DEPLOYMENT_FAILED";

export const RECOVERY_ACTION_LABEL: Record<RecoveryKind, string> = {
  CALL_FAILED: "Retry Call",
  REQUIREMENTS_FAILED: "Retry Extraction",
  GITHUB_FAILED: "Retry Repo Prep",
  BUILD_VALIDATION_FAILED: "Retry Build",
  DEPLOYMENT_FAILED: "Retry Deploy",
};

export const RECOVERY_RESUME_STATE: Record<RecoveryKind, string> = {
  CALL_FAILED: "CALL_QUEUED",
  REQUIREMENTS_FAILED: "REQUIREMENTS_PROCESSING",
  GITHUB_FAILED: "REPOSITORY_PREPARING",
  BUILD_VALIDATION_FAILED: "BUILD_QUEUED",
  DEPLOYMENT_FAILED: "DEPLOYMENT_QUEUED",
};

// Used to guess which retry action applies when a project is sitting in
// MANUAL_INTERVENTION_REQUIRED (which, unlike a *_FAILED state, doesn't
// identify the failed stage on its own — only project.failedStage does, and
// that's a free-form label set by whichever stage called transitionProject).
const RECOVERY_KEYWORDS: Record<RecoveryKind, readonly string[]> = {
  CALL_FAILED: ["CALL", "VOICE"],
  REQUIREMENTS_FAILED: ["REQUIREMENT"],
  GITHUB_FAILED: ["GITHUB", "REPO"],
  BUILD_VALIDATION_FAILED: ["BUILD", "DEVIN"],
  DEPLOYMENT_FAILED: ["DEPLOY", "FIREBASE"],
};

/** States (besides MANUAL_INTERVENTION_REQUIRED) that should show the recovery panel. */
export const RECOVERABLE_FAILURE_STATES = new Set<string>(Object.keys(RECOVERY_ACTION_LABEL));

export function resolveRecoveryKind(state: string, failedStage?: string): RecoveryKind | undefined {
  if (state in RECOVERY_ACTION_LABEL) return state as RecoveryKind;
  if (state !== "MANUAL_INTERVENTION_REQUIRED" || !failedStage) return undefined;
  const needle = failedStage.toUpperCase();
  return (Object.keys(RECOVERY_KEYWORDS) as RecoveryKind[]).find((kind) =>
    RECOVERY_KEYWORDS[kind].some((word) => needle.includes(word)),
  );
}
