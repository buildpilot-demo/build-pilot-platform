import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Id } from '@convex/_generated/dataModel'
import {
  useListBusinesses,
  useSearchBusinesses,
  useSelectBusiness,
} from '../../hooks/useBusinessSearch'
import { useCallPhoneOverride } from '../../hooks/useCallPhoneOverride'

interface SearchFormState {
  city: string
  area: string
  category: string
  radius: string
  maxResults: string
}

const EMPTY_FORM: SearchFormState = { city: '', area: '', category: '', radius: '', maxResults: '' }

type CallStatus = { state: 'calling' } | { state: 'called' } | { state: 'error'; message: string }

/**
 * PHASE 1 (Business Discovery, docs/project-requirements.md Section 6).
 * Never calls Context.dev directly (Section 4.1 "Must NOT") -- the form
 * only triggers convex/businesses.ts::searchBusinesses; the results list
 * is a reactive convex/businesses.ts::listBusinesses query.
 */
export function SearchPage() {
  const navigate = useNavigate()
  const searchBusinesses = useSearchBusinesses()
  const selectBusiness = useSelectBusiness()
  const [callPhoneOverride, setCallPhoneOverride] = useCallPhoneOverride()

  const [form, setForm] = useState<SearchFormState>(EMPTY_FORM)
  const [submittedFilters, setSubmittedFilters] = useState<{
    city: string
    category: string
  } | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [callStatusByBusiness, setCallStatusByBusiness] = useState<
    Record<string, CallStatus | undefined>
  >({})

  const businesses = useListBusinesses(
    submittedFilters ? { city: submittedFilters.city, category: submittedFilters.category } : {},
  )

  const updateField = (field: keyof SearchFormState) => (event: FormEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value
    setForm((current) => ({ ...current, [field]: value }))
  }

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSearchError(null)
    setIsSearching(true)
    // Set immediately (not after the action resolves) so the results list
    // is already watching the right (city, category) as searchBusinesses
    // writes rows -- no manual refetch needed.
    setSubmittedFilters({ city: form.city, category: form.category })

    try {
      await searchBusinesses({
        city: form.city,
        area: form.area || undefined,
        category: form.category,
        radius: form.radius ? Number(form.radius) : undefined,
        maxResults: form.maxResults ? Number(form.maxResults) : undefined,
      })
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Search failed.')
    } finally {
      setIsSearching(false)
    }
  }

  const handleCall = async (businessId: Id<'businesses'>) => {
    setCallStatusByBusiness((current) => ({ ...current, [businessId]: { state: 'calling' } }))
    try {
      // Fire-and-forget from the admin's perspective: selectBusiness creates
      // the Lead/Project/WorkflowRun and schedules the call in the
      // background. We stay on this page either way.
      await selectBusiness({
        businessId,
        overridePhone: callPhoneOverride || undefined,
      })
      setCallStatusByBusiness((current) => ({ ...current, [businessId]: { state: 'called' } }))
    } catch (error) {
      setCallStatusByBusiness((current) => ({
        ...current,
        [businessId]: {
          state: 'error',
          message: error instanceof Error ? error.message : 'Failed to start call.',
        },
      }))
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Business search</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Search for nearby businesses, then call one to create a lead and project.
        </p>
      </div>

      <form onSubmit={handleSearch} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">City</span>
          <input
            required
            value={form.city}
            onChange={updateField('city')}
            placeholder="Dubai"
            className="rounded-md border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Area</span>
          <input
            value={form.area}
            onChange={updateField('area')}
            placeholder="Marina"
            className="rounded-md border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Category</span>
          <input
            required
            value={form.category}
            onChange={updateField('category')}
            placeholder="restaurant"
            className="rounded-md border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Radius (km)</span>
          <input
            type="number"
            min={0}
            value={form.radius}
            onChange={updateField('radius')}
            placeholder="optional"
            className="rounded-md border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Max results</span>
          <input
            type="number"
            min={10}
            max={100}
            value={form.maxResults}
            onChange={updateField('maxResults')}
            placeholder="10-100"
            className="rounded-md border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <div className="sm:col-span-2 lg:col-span-5">
          <button
            type="submit"
            disabled={isSearching}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {isSearching ? 'Searching…' : 'Search'}
          </button>
          {searchError && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{searchError}</p>
          )}
        </div>
      </form>

      <label className="flex max-w-md flex-col gap-1 text-sm">
        <span className="font-medium">Call phone override</span>
        <input
          value={callPhoneOverride}
          onChange={(event) => setCallPhoneOverride(event.currentTarget.value)}
          placeholder="+971588711809"
          className="rounded-md border border-slate-300 px-3 py-2 font-mono dark:border-slate-700 dark:bg-slate-900"
        />
        <span className="text-xs text-slate-500 dark:text-slate-500">
          Context.dev search can't return verified phone numbers, so every result is pre-assigned
          the backend's default call number. Set a number here to call something else instead -- it
          applies to every "Call" click below until changed.
        </span>
      </label>

      <div>
        {businesses === undefined ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : submittedFilters === null ? (
          <p className="text-sm text-slate-500">Run a search to see results here.</p>
        ) : businesses.length === 0 ? (
          <p className="text-sm text-slate-500">No businesses found for this search yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {businesses.map((business) => {
              const hasProject = business.projectId !== null
              const callStatus = callStatusByBusiness[business._id]

              return (
                <li
                  key={business._id}
                  onClick={
                    hasProject ? () => navigate(`/projects/${business.projectId}`) : undefined
                  }
                  className={[
                    'flex flex-wrap items-center justify-between gap-3 p-4',
                    hasProject ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900' : '',
                  ].join(' ')}
                >
                  <div>
                    <p className="font-medium">{business.name}</p>
                    <p className="text-sm text-slate-500">
                      {business.category} · {business.area ? `${business.area}, ` : ''}
                      {business.city}
                    </p>
                    {business.leadStatus && (
                      <p className="mt-1 text-xs font-medium text-slate-400">
                        Lead status: {business.leadStatus}
                      </p>
                    )}
                    {callStatus?.state === 'error' && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {callStatus.message}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {callStatus?.state === 'calling' && (
                      <span className="text-xs text-slate-500">Starting call…</span>
                    )}
                    {callStatus?.state === 'called' && (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400">
                        Call started
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        void handleCall(business._id)
                      }}
                      disabled={callStatus?.state === 'calling'}
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                    >
                      Call
                    </button>
                    {hasProject && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          navigate(`/projects/${business.projectId}`)
                        }}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium dark:border-slate-700"
                      >
                        View project
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
