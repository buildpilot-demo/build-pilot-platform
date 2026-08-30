import { useMutation } from 'convex/react'
import { api } from '@convex/_generated/api'

/**
 * Section 11 Failure Recovery: "REQUIREMENTS_FAILED -> Retry Extraction ->
 * Resume From: REQUIREMENTS_PROCESSING." Wraps
 * `convex/requirements.ts::retryExtraction`, the mutation the project
 * detail panel's "Retry Extraction" button calls.
 */
export function useRetryExtraction() {
  return useMutation(api.requirements.retryExtraction)
}
