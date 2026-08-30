import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'

/**
 * Reactive project-detail subscription for the `/projects/:projectId`
 * panel. Convex pushes updates automatically whenever the project, its
 * latest voiceSession, its transcript, or its requirements change — no
 * polling code needed here.
 *
 * Returns `undefined` while the query is loading, `null` if the project
 * doesn't exist, and the detail payload otherwise.
 */
export function useProjectDetail(projectId: Id<'projects'> | undefined) {
  return useQuery(api.projects.getProjectDetail, projectId ? { projectId } : 'skip')
}

export type ProjectDetail = NonNullable<ReturnType<typeof useProjectDetail>>
