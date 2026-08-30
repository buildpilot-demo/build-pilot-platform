import type { Project, ProjectDetails } from "../lib/types";
import { useRecoveryAction } from "../lib/useRecoveryAction";

// Single-button failure recovery, replacing the old "Operator action
// required" panel: Retry for a *_FAILED state Convex has a dedicated retry
// action for, Resume for everything else still able to move forward
// (external-provider failure with no dedicated retry, or a stuck stage).
export function RecoveryActionButton({
  project,
  revisionRequest,
}: {
  project?: Project;
  revisionRequest?: ProjectDetails["revisionRequest"];
}) {
  const recovery = useRecoveryAction(project, revisionRequest);
  if (!recovery.mode) return null;

  const label = recovery.mode === "retry" ? "Retry" : "Resume";
  return (
    <div className="recovery-action">
      <button className="button button--dark" disabled={recovery.busy} onClick={recovery.run}>
        {recovery.busy ? `${recovery.mode === "retry" ? "Retrying" : "Resuming"}…` : label}
      </button>
      {recovery.error && <span className="recovery-action__error" role="status">{recovery.error}</span>}
    </div>
  );
}
