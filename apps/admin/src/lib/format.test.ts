import { describe, expect, it } from 'vitest'
import { formatElapsed, formatTimestamp, formatWorkflowState } from './format'

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

describe('formatElapsed', () => {
  it('renders seconds only under a minute', () => {
    expect(formatElapsed(42_000)).toBe('42s')
  })

  it('renders minutes and seconds under an hour', () => {
    expect(formatElapsed(3 * 60_000 + 12_000)).toBe('3m 12s')
  })

  it('renders hours and minutes at an hour or more', () => {
    expect(formatElapsed(60 * 60_000 + 5 * 60_000)).toBe('1h 05m')
  })

  it('clamps negative durations to 0s', () => {
    expect(formatElapsed(-500)).toBe('0s')
  })
})
