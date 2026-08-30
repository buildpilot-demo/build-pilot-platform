import { describe, expect, it } from 'vitest'
import { PRIMARY_STATES, primaryStepIndexFor } from './pipelineStages'

describe('primaryStepIndexFor', () => {
  it('returns the direct index for a primary state', () => {
    expect(primaryStepIndexFor('DEVIN_BUILDING', null)).toBe(
      PRIMARY_STATES.indexOf('DEVIN_BUILDING'),
    )
  })

  it('maps a *_FAILED-adjacent failedStage to the primary state it was blocking', () => {
    expect(primaryStepIndexFor('CALL_FAILED', 'VOICE_CALL')).toBe(
      PRIMARY_STATES.indexOf('CALL_QUEUED'),
    )
  })

  it('maps MANUAL_INTERVENTION_REQUIRED via failedStage the same way', () => {
    expect(primaryStepIndexFor('MANUAL_INTERVENTION_REQUIRED', 'REQUIREMENTS_EXTRACTION')).toBe(
      PRIMARY_STATES.indexOf('REQUIREMENTS_PROCESSING'),
    )
  })

  it('returns null for a null state', () => {
    expect(primaryStepIndexFor(null, null)).toBeNull()
  })

  it('returns null when failedStage has no known mapping (e.g. a revision-loop failure)', () => {
    expect(primaryStepIndexFor('REVISION_BUILD_FAILED', null)).toBeNull()
  })
})
