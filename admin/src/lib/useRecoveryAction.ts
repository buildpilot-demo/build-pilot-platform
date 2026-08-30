import { useState } from "react";
import { useAction } from "convex/react";
import { adminApi } from "./api";
import type { Project, ProjectDetails } from "./types";
import { resolveRecoveryKind, type RecoveryKind } from "./failureRecovery";
import { resolvePipelineProgress } from "./pipeline";
import { resolveNextCheckpoint } from "./resume";

export type RecoveryActionState = {
  // "retry" = a *_FAILED state Convex recorded with a dedicated retry
  // action wired up (Section 11's table). "resume" = everything else that
  // can still move forward — an external-provider failure with no
  // dedicated retry, or a project just sitting stuck mid-stage.
  mode?: "retry" | "resume";
  busy: boolean;
  error?: string;
  run: () => void;
};

export function useRecoveryAction(
  project: Project | undefined,
  revisionRequest: ProjectDetails["revisionRequest"] | undefined,
): RecoveryActionState {
  const retryCall = useAction(adminApi.retryCall);
  const retryExtraction = useAction(adminApi.retryExtraction);
  const retryRepoPrep = useAction(adminApi.retryRepoPrep);
  const retryBuild = useAction(adminApi.retryBuild);
  const retryDeploy = useAction(adminApi.retryDeploy);
  const resumeProject = useAction(adminApi.resumeProject);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!project) return { busy: false, run: () => {} };

  const revisionFailed = revisionRequest?.status === "REVISION_BUILD_FAILED";
  const kind = resolveRecoveryKind(project.state, project.failedStage);
  const resumeTarget = resolveNextCheckpoint(project.state);

  const retryRunners: Record<RecoveryKind, () => Promise<unknown>> = {
    CALL_FAILED: () => retryCall({ projectId: project._id }),
    REQUIREMENTS_FAILED: () => retryExtraction({ projectId: project._id }),
    GITHUB_FAILED: () => retryRepoPrep({ projectId: project._id }),
    BUILD_VALIDATION_FAILED: () => retryBuild({ projectId: project._id }),
    DEPLOYMENT_FAILED: () => retryDeploy({ projectId: project._id }),
  };

  if (revisionFailed) {
    return {
      mode: "retry",
      busy,
      error,
      run: () => void run(() => retryBuild({ projectId: project._id, revisionRequestId: revisionRequest!._id })),
    };
  }
  if (kind) {
    return { mode: "retry", busy, error, run: () => void run(retryRunners[kind]) };
  }
  // Don't offer "Resume" while a stage is genuinely still working (e.g.
  // DEVIN_BUILDING) — resolveNextCheckpoint maps every in-flight primary
  // state to a checkpoint too (so a stuck project can still be nudged
  // forward), but showing the button while the pipeline is actively
  // progressing reads as "this is stuck" when it isn't.
  const isActivelyRunning = resolvePipelineProgress(project.state, project.failedStage).status === "active";
  if (resumeTarget && !isActivelyRunning) {
    return {
      mode: "resume",
      busy,
      error,
      run: () => void run(() => resumeProject({ projectId: project._id, targetState: resumeTarget })),
    };
  }
  return { busy, error, run: () => {} };
}
