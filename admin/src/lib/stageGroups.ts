import { resolveNextCheckpoint } from "./resume";

// Coarser grouping of the primary pipeline into the 7 checkpoints an
// operator can resume from (mirrors resume.ts's RESUMABLE_CHECKPOINTS) —
// used to bucket activityEvents into one "behind the scenes" panel per
// pipeline stage on the Project page (see StagePanelStack). Order matches
// the primary state sequence so panels stack in pipeline order.
export const STAGE_GROUPS: ReadonlyArray<{ key: string; title: string }> = [
  { key: "CALL_QUEUED", title: "Voice Call" },
  { key: "REQUIREMENTS_PROCESSING", title: "Requirements Extraction" },
  { key: "DOCUMENTS_GENERATING", title: "Document Generation" },
  { key: "REPOSITORY_PREPARING", title: "Repository Preparation" },
  { key: "BUILD_QUEUED", title: "Devin Build" },
  { key: "DEPLOYMENT_QUEUED", title: "Deployment" },
  { key: "NOTIFICATION_PENDING", title: "Notification" },
];

// Falls back to fromState when toState doesn't resolve (e.g. a transition
// *into* MANUAL_INTERVENTION_REQUIRED, which resolveNextCheckpoint has no
// entry for on purpose - see resume.ts) so the event still lands under the
// stage it actually concerns.
export function stageGroupKey(event: { toState?: string; fromState?: string }): string | undefined {
  return resolveNextCheckpoint(event.toState) ?? resolveNextCheckpoint(event.fromState);
}
