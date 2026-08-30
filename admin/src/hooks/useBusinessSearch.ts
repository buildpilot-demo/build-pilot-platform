import { useAction, useMutation, useQuery } from 'convex/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'

export interface SearchBusinessesArgs {
  city: string
  area?: string
  category: string
  radius?: number
  maxResults?: number
}

/** convex/businesses.ts::searchBusinesses -- Context.dev search, called only from here, never directly from a component. */
export function useSearchBusinesses() {
  return useAction(api.businesses.searchBusinesses)
}

export interface ListBusinessesFilters {
  city?: string
  category?: string
  contactEligibleOnly?: boolean
}

/** convex/businesses.ts::listBusinesses -- reactive; re-renders as searchBusinesses writes rows. */
export function useListBusinesses(filters: ListBusinessesFilters) {
  return useQuery(api.businesses.listBusinesses, filters)
}

export interface SelectBusinessArgs {
  businessId: Id<'businesses'>
  selectedBy?: string
  overridePhone?: string
}

/** convex/projects.ts::selectBusiness -- creates Lead/Project/WorkflowRun and schedules the call; never navigates on its own. */
export function useSelectBusiness() {
  return useMutation(api.projects.selectBusiness)
}
