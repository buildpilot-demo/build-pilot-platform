import { PRIMARY_STATES } from '../lib/pipelineStages'
import { formatWorkflowState } from '../lib/format'

interface PipelineStepperProps {
  /** Index into PRIMARY_STATES to highlight as "current", or null if unknown. */
  currentStepIndex: number | null
  /** Renders the current step in the failure color instead of the normal "active" color. */
  isFlagged: boolean
}

/**
 * Horizontal stepper matching the primary state sequence in
 * docs/project-requirements.md Section 8 (PROJECT_CREATED through
 * DELIVERED). Purely presentational -- the project card around it decides
 * `currentStepIndex`/`isFlagged`.
 */
export function PipelineStepper({ currentStepIndex, isFlagged }: PipelineStepperProps) {
  return (
    <ol className="flex gap-1" aria-label="Pipeline progress">
      {PRIMARY_STATES.map((state, index) => {
        const isCurrent = index === currentStepIndex
        const isReached = currentStepIndex !== null && index <= currentStepIndex

        const color = isCurrent
          ? isFlagged
            ? 'bg-red-500 dark:bg-red-500'
            : 'bg-slate-900 dark:bg-slate-100'
          : isReached
            ? 'bg-slate-400 dark:bg-slate-600'
            : 'bg-slate-200 dark:bg-slate-800'

        return (
          <li key={state} title={formatWorkflowState(state)} className="min-w-[4px] flex-1">
            <div className={`h-2 rounded-full ${color}`} />
          </li>
        )
      })}
    </ol>
  )
}
