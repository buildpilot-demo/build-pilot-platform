import { describe, expect, it } from 'vitest'
import { isLikelyE164PhoneNumber, isNonEmpty } from './validation'

describe('isLikelyE164PhoneNumber', () => {
  it('accepts a valid E.164 number', () => {
    expect(isLikelyE164PhoneNumber('+14155552671')).toBe(true)
  })

  it('rejects numbers without a leading +', () => {
    expect(isLikelyE164PhoneNumber('14155552671')).toBe(false)
  })

  it('rejects non-numeric input', () => {
    expect(isLikelyE164PhoneNumber('+1abc5552671')).toBe(false)
  })
})

describe('isNonEmpty', () => {
  it('rejects whitespace-only strings', () => {
    expect(isNonEmpty('   ')).toBe(false)
  })

  it('accepts a string with content', () => {
    expect(isNonEmpty('  Dubai  ')).toBe(true)
  })
})
