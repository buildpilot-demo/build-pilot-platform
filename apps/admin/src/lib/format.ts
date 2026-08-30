/**
 * Formatting helpers shared across pages. Keep these presentation-only —
 * anything that decides workflow state belongs in Convex, not here.
 */

const WORKFLOW_STATE_LABELS: Record<string, string> = {
  PROJECT_CREATED: 'Project created',
  CALL_QUEUED: 'Call queued',
  CALLING: 'Calling',
  CALL_COMPLETED: 'Call completed',
  TRANSCRIPT_RECEIVED: 'Transcript received',
  REQUIREMENTS_PROCESSING: 'Processing requirements',
  REQUIREMENTS_READY: 'Requirements ready',
  REQUIREMENTS_VALIDATED: 'Requirements validated',
  DOCUMENTS_READY: 'Documents ready',
  REPOSITORY_READY: 'Repository ready',
  DEVIN_BUILDING: 'Devin building',
  BUILD_COMPLETED: 'Build completed',
  DEPLOYING: 'Deploying',
  LIVE: 'Live',
  DELIVERED: 'Delivered',
}

/** Renders a `workflowRuns`/`revisionRequests` state enum value for display. */
export function formatWorkflowState(state: string): string {
  return (
    WORKFLOW_STATE_LABELS[state] ??
    state
      .toLowerCase()
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  )
}

/** Formats a Convex `_creationTime`/timestamp (ms since epoch) for display. */
export function formatTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
