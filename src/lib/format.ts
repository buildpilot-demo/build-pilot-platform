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

/**
 * Renders a duration (ms) as a short "elapsed" string, e.g. "42s", "3m 12s",
 * "1h 05m". Intended for "time in this stage" -- computed from `Date.now()`
 * at render time, not on a timer: this app has no setInterval/polling
 * anywhere, so the value only refreshes when something (a Convex query
 * subscription firing on real data, or an unrelated re-render) causes the
 * component to render again.
 */
export function formatElapsed(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  }
  return `${seconds}s`
}
