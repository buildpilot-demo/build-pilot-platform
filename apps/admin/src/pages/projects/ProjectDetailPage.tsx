import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { ComingSoon } from '../../components/ComingSoon'
import { formatTimestamp, formatWorkflowState } from '../../lib/format'
import { useProjectDetail, type ProjectDetail } from '../../hooks/useProjectDetail'
import { useRetryExtraction } from '../../hooks/useRetryExtraction'
import type { Id } from '../../../../../convex/_generated/dataModel'

/** Mirrors convex/schema.ts's `requirementsDataValidator` shape. */
interface RequirementsData {
  businessName: string
  purpose?: string
  services?: string[]
  targetUsers?: string[]
  pages: { name: string; description?: string }[]
  branding?: { primaryColor?: string; secondaryColor?: string; fonts?: string[] }
  cta: { label: string; type?: string; target?: string }
  contactDetails?: { phone?: string; email?: string; address?: string }
}

const REQUIREMENTS_STAGE = 'REQUIREMENTS_EXTRACTION'

interface TranscriptTurn {
  speaker: 'agent' | 'customer'
  text: string
  startedAtMs?: number
}

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const detail = useProjectDetail(projectId as Id<'projects'> | undefined)

  if (!projectId) {
    return <ComingSoon title="Project" description="No project ID was provided." />
  }

  if (detail === undefined) {
    return <p className="text-slate-500 dark:text-slate-400">Loading project…</p>
  }

  if (detail === null) {
    return (
      <ComingSoon
        title="Project not found"
        description={`No project exists with ID ${projectId}.`}
      />
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          {detail.businessName ?? 'Project'}
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Status:{' '}
          <span className="font-medium">
            {formatWorkflowState(detail.project.state ?? 'PROJECT_CREATED')}
          </span>
        </p>
      </header>

      <CallStatusPanel detail={detail} />
      <TranscriptPanel detail={detail} />
      <RequirementsPanel detail={detail} />
      <RequirementsFailurePanel detail={detail} projectId={projectId as Id<'projects'>} />
    </div>
  )
}

/**
 * Requirement 1: reactively shows voiceSessions status (CALL_QUEUED /
 * CALLING / CALL_COMPLETED) for the current project. `detail` already
 * comes from a `useQuery` subscription (see `useProjectDetail`), so this
 * panel re-renders automatically as the project/voiceSession change —
 * nothing here polls.
 */
function CallStatusPanel({ detail }: { detail: ProjectDetail }) {
  const { project, voiceSession } = detail

  return (
    <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Voice call</h2>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Field
          label="Project state"
          value={formatWorkflowState(project.state ?? 'PROJECT_CREATED')}
        />
        <Field label="Session status" value={voiceSession ? voiceSession.status : '—'} />
        <Field label="Target number" value={voiceSession?.targetPhoneE164 ?? '—'} />
        <Field
          label="Started"
          value={voiceSession?.startedAt ? formatTimestamp(voiceSession.startedAt) : '—'}
        />
      </dl>
    </section>
  )
}

/** Requirement 2: once a transcript exists (TRANSCRIPT_RECEIVED or later), render it. */
function TranscriptPanel({ detail }: { detail: ProjectDetail }) {
  const { transcript } = detail
  if (!transcript) {
    return null
  }

  return (
    <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Call transcript</h2>
      <div className="mt-2 max-h-80 space-y-2 overflow-y-auto text-sm">
        {transcript.turns && transcript.turns.length > 0 ? (
          transcript.turns.map((turn: TranscriptTurn, index: number) => (
            <p key={index}>
              <span className="font-medium capitalize text-slate-700 dark:text-slate-300">
                {turn.speaker}:
              </span>{' '}
              <span className="text-slate-600 dark:text-slate-400">{turn.text}</span>
            </p>
          ))
        ) : (
          <pre className="whitespace-pre-wrap text-slate-600 dark:text-slate-400">
            {transcript.rawTranscript}
          </pre>
        )}
      </div>
    </section>
  )
}

/**
 * Requirement 3: once requirements are VALIDATED, render the structured
 * JSON field-by-field (business name, pages, CTA, branding, contact
 * details, ...) rather than a raw JSON dump.
 */
function RequirementsPanel({ detail }: { detail: ProjectDetail }) {
  const requirements = detail.requirements
  if (!requirements || requirements.status !== 'VALIDATED' || !requirements.data) {
    return null
  }
  const data = requirements.data as RequirementsData

  return (
    <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Requirements</h2>

      <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <Field label="Business name" value={data.businessName} />
        <Field label="Purpose" value={data.purpose ?? '—'} />
        <Field label="Services" value={joinOrDash(data.services)} />
        <Field label="Target users" value={joinOrDash(data.targetUsers)} />
      </dl>

      <div className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Pages
        </h3>
        <ul className="mt-1 space-y-1 text-sm">
          {data.pages.map((page) => (
            <li key={page.name}>
              <span className="font-medium">{page.name}</span>
              {page.description ? (
                <span className="text-slate-500 dark:text-slate-400"> — {page.description}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Call to action
          </h3>
          <dl className="mt-1 space-y-1 text-sm">
            <Field label="Label" value={data.cta.label} />
            <Field label="Type" value={data.cta.type ?? '—'} />
            <Field label="Target" value={data.cta.target ?? '—'} />
          </dl>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Branding
          </h3>
          <dl className="mt-1 space-y-1 text-sm">
            <Field label="Primary color" value={data.branding?.primaryColor ?? '—'} />
            <Field label="Secondary color" value={data.branding?.secondaryColor ?? '—'} />
            <Field label="Fonts" value={joinOrDash(data.branding?.fonts)} />
          </dl>
        </div>
      </div>

      <div className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Contact details
        </h3>
        <dl className="mt-1 grid grid-cols-1 gap-1 text-sm sm:grid-cols-3">
          <Field label="Phone" value={data.contactDetails?.phone ?? '—'} />
          <Field label="Email" value={data.contactDetails?.email ?? '—'} />
          <Field label="Address" value={data.contactDetails?.address ?? '—'} />
        </dl>
      </div>
    </section>
  )
}

/**
 * Requirement 4: if the project stalled at requirement extraction, show
 * the errorCode and a "Retry Extraction" button (Section 11 Failure
 * Recovery: REQUIREMENTS_FAILED -> Retry Extraction -> resume from
 * REQUIREMENTS_PROCESSING). In practice `extractRequirements` walks
 * REQUIREMENTS_FAILED straight through to MANUAL_INTERVENTION_REQUIRED in
 * one mutation (no auto-retry window for a bad/placeholder OpenAI
 * response), so this also covers that state as long as
 * `failedStage === "REQUIREMENTS_EXTRACTION"` — the same case
 * `retryExtraction` itself accepts.
 */
function RequirementsFailurePanel({
  detail,
  projectId,
}: {
  detail: ProjectDetail
  projectId: Id<'projects'>
}) {
  const { project } = detail
  const retryExtraction = useRetryExtraction()
  const [isRetrying, setIsRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)

  const isStalled =
    project.state === 'REQUIREMENTS_FAILED' ||
    (project.state === 'MANUAL_INTERVENTION_REQUIRED' && project.failedStage === REQUIREMENTS_STAGE)

  if (!isStalled) {
    return null
  }

  const handleRetry = async () => {
    setIsRetrying(true)
    setRetryError(null)
    try {
      await retryExtraction({ projectId })
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsRetrying(false)
    }
  }

  return (
    <section className="rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
      <h2 className="text-sm font-semibold text-red-900 dark:text-red-200">
        Requirement extraction failed
      </h2>
      <dl className="mt-2 space-y-1 text-sm text-red-800 dark:text-red-300">
        <Field label="Error code" value={project.errorCode ?? 'UNKNOWN'} />
        <Field label="Retryable" value={project.retryable ? 'yes' : 'no'} />
      </dl>
      <button
        type="button"
        onClick={handleRetry}
        disabled={isRetrying}
        className="mt-3 rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isRetrying ? 'Retrying…' : 'Retry Extraction'}
      </button>
      {retryError ? (
        <p className="mt-2 text-sm text-red-700 dark:text-red-400">{retryError}</p>
      ) : null}
    </section>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </dt>
      <dd className="text-slate-800 dark:text-slate-200">{value}</dd>
    </div>
  )
}

function joinOrDash(items: string[] | undefined): string {
  return items && items.length > 0 ? items.join(', ') : '—'
}
