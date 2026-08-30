import { Link } from 'react-router-dom'
import { PipelineStepper } from '../../components/PipelineStepper'
import { useDashboardProjects } from '../../hooks/useDashboardProjects'
import { formatElapsed, formatWorkflowState } from '../../lib/format'
import { isFailureState, primaryStepIndexFor } from '../../lib/pipelineStages'

/**
 * Stage 8 (Person A), T7.x. Real-time pipeline overview: one card per
 * project, each showing a stepper matching the primary state sequence
 * (docs/project-requirements.md Section 8), the currently-active stage,
 * elapsed time in that stage, and a distinct flag for any project in a
 * `*_FAILED`/MANUAL_INTERVENTION_REQUIRED state. Entirely driven by
 * convex/projects.ts::listProjectsForDashboard's reactive subscription --
 * no setInterval/polling anywhere, so this updates the instant any stage's
 * mutation changes a project's state, from anywhere in the pipeline.
 */
export function DashboardPage() {
  const projects = useDashboardProjects()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Pipeline dashboard</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Every project's current stage, live -- this updates the instant a backend mutation changes
          a project's state.
        </p>
      </div>

      {projects === undefined ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="text-sm text-slate-500">
          No projects yet.{' '}
          <Link to="/search" className="underline">
            Search for a business
          </Link>{' '}
          and call it to start one.
        </p>
      ) : (
        <ul className="space-y-3">
          {projects.map((project) => {
            const flagged = project.state !== null && isFailureState(project.state)
            const stepIndex = primaryStepIndexFor(project.state, project.failedStage)
            // Deliberately reads Date.now() at render time rather than via
            // setInterval/polling (see this file's header comment): the
            // value only refreshes when Convex reactivity (or an unrelated
            // re-render) causes this component to render again.
            // eslint-disable-next-line react-hooks/purity
            const elapsed = formatElapsed(Date.now() - project.stateEnteredAt)

            return (
              <li
                key={project.projectId}
                className={[
                  'rounded-lg border p-4',
                  flagged
                    ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40'
                    : 'border-slate-200 dark:border-slate-800',
                ].join(' ')}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <Link to={`/projects/${project.projectId}`} className="font-medium underline">
                      {project.businessName}
                    </Link>
                    <p className="font-mono text-xs text-slate-500">{project.correlationId}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={[
                        'rounded-full px-2 py-0.5 text-xs font-semibold',
                        flagged
                          ? 'bg-red-600 text-white'
                          : 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900',
                      ].join(' ')}
                    >
                      {project.state ? formatWorkflowState(project.state) : 'Pending'}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-500">
                      {elapsed} in this stage
                    </span>
                  </div>
                </div>

                <div className="mt-3">
                  <PipelineStepper currentStepIndex={stepIndex} isFlagged={flagged} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
