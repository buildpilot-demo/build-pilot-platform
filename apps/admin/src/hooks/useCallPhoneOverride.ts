import { useState } from 'react'

const STORAGE_KEY = 'buildpilot:callPhoneOverride'

function readInitialValue(): string {
  if (typeof window === 'undefined') {
    return ''
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored !== null) {
      return stored
    }
  } catch {
    // localStorage unavailable (e.g. private browsing) -- fall through to the env default.
  }
  return import.meta.env.VITE_DEFAULT_CALL_PHONE ?? ''
}

/**
 * The single "call phone override" input on the search screen (T2.4).
 * Context.dev can't supply verified phone numbers, so every business is
 * pre-assigned the backend's DEFAULT_CALL_PHONE at search time (T2.2) --
 * this is only for an admin who wants to dial a different number for
 * testing/demo purposes. Persisted in localStorage and pre-filled from
 * VITE_DEFAULT_CALL_PHONE so it survives reloads but stays editable.
 */
export function useCallPhoneOverride() {
  const [value, setValue] = useState<string>(readInitialValue)

  const setCallPhoneOverride = (next: string) => {
    setValue(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Ignore write failures -- the in-memory value for this session still works.
    }
  }

  return [value, setCallPhoneOverride] as const
}
