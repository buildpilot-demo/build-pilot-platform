import { describe, expect, it } from 'vitest'
import { formatTimestamp, formatWorkflowState } from './format'

describe('formatWorkflowState', () => {
  it('uses the known label for a mapped state', () => {
    expect(formatWorkflowState('DEVIN_BUILDING')).toBe('Devin building')
  })

  it('falls back to title-casing unknown states', () => {
    expect(formatWorkflowState('SOME_NEW_STATE')).toBe('Some New State')
  })
})

describe('formatTimestamp', () => {
  it('renders a human-readable date/time string', () => {
    const result = formatTimestamp(Date.UTC(2026, 0, 1, 12, 0, 0))
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})
