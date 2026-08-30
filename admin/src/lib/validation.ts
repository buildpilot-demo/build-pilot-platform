/**
 * Client-side validation helpers for form input. These are UX-only checks —
 * Convex must re-validate everything server-side (see docs/project-requirements.md
 * Section 12.2); nothing here is a source of truth.
 */

const E164_PATTERN = /^\+[1-9]\d{1,14}$/

/** Checks whether a phone number string looks like it's in E.164 format. */
export function isLikelyE164PhoneNumber(value: string): boolean {
  return E164_PATTERN.test(value.trim())
}

/** Checks whether a search query is non-empty after trimming whitespace. */
export function isNonEmpty(value: string): boolean {
  return value.trim().length > 0
}
