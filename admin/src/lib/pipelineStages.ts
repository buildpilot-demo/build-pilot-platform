// Re-exports the primary-pipeline state list straight from the Convex
// backend's own state machine (convex/stateMachine.ts, Shared Contract #2)
// instead of duplicating the enum here -- that module has no dependency on
// convex/_generated, so importing it is safe and keeps the dashboard's
// stepper guaranteed in sync with the real transition graph.
import {
  FAILURE_STATES,
  MANUAL_INTERVENTION_REQUIRED,
  PRIMARY_STATES,
  isFailureState,
  type ProjectState,
} from '@convex/stateMachine'

export { FAILURE_STATES, MANUAL_INTERVENTION_REQUIRED, PRIMARY_STATES, isFailureState }
export type { ProjectState }

/**
 * Presentation-only: which PRIMARY_STATES entry a given `failedStage` (the
 * free-form `stage` string every transitionProject call records, e.g.
 * "VOICE_CALL") was blocking when a project entered a `*_FAILED` state or
 * MANUAL_INTERVENTION_REQUIRED. Used only to decide which step the
 * dashboard's stepper should still highlight while flagging the failure --
 * mirrors convex/lib/externalCall.ts's own (module-private) STAGE_RESUME_STATE;
 * keep the two in sync if new stages are added there.
 */
const FAILED_STAGE_TO_PRIMARY_STATE: Partial<Record<string, ProjectState>> = {
  VOICE_CALL: 'CALL_QUEUED',
  REQUIREMENTS_EXTRACTION: 'REQUIREMENTS_PROCESSING',
  DOCUMENT_GENERATION: 'DOCUMENTS_GENERATING',
  REPOSITORY_PREPARATION: 'REPOSITORY_PREPARING',
  DEVIN_BUILD: 'BUILD_QUEUED',
  BUILD_VALIDATION: 'BUILD_QUEUED',
  FIREBASE_DEPLOY: 'DEPLOYMENT_QUEUED',
  WHATSAPP_DELIVERY: 'NOTIFICATION_PENDING',
}

/**
 * The PRIMARY_STATES index the dashboard stepper should highlight for a
 * project's current `state` (+ `failedStage`, needed when `state` doesn't
 * directly appear in PRIMARY_STATES -- a `*_FAILED` state or
 * MANUAL_INTERVENTION_REQUIRED). Returns null when no primary-pipeline
 * position applies (e.g. a revision-loop failure, or a brand-new row from
 * before its first transitionProject call has landed).
 */
export function primaryStepIndexFor(
  state: ProjectState | null,
  failedStage: string | null,
): number | null {
  if (state === null) {
    return null
  }
  const directIndex = (PRIMARY_STATES as readonly string[]).indexOf(state)
  if (directIndex !== -1) {
    return directIndex
  }
  if (!failedStage) {
    return null
  }
  const resumeState = FAILED_STAGE_TO_PRIMARY_STATE[failedStage]
  if (!resumeState) {
    return null
  }
  const resumeIndex = (PRIMARY_STATES as readonly string[]).indexOf(resumeState)
  return resumeIndex === -1 ? null : resumeIndex
}
