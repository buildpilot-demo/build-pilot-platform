import { useQuery } from 'convex/react'
import { api } from '@convex/_generated/api'

/**
 * convex/projects.ts::listProjectsForDashboard -- reactive; the /dashboard
 * pipeline view re-renders the instant any mutation anywhere in the
 * pipeline changes a project's/workflowRun's state. No polling.
 */
export function useDashboardProjects() {
  return useQuery(api.projects.listProjectsForDashboard, {})
}
