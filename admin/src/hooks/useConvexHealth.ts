import { useConvexConnectionState } from 'convex/react'

export interface ConvexHealth {
  isConnected: boolean
  hasEverConnected: boolean
}

/**
 * Thin wrapper around Convex's connection-state subscription. Later stages
 * should add their own query/mutation hooks here (e.g. `useProject`,
 * `useBusinessSearch`) rather than calling `useQuery`/`useMutation` directly
 * from page components.
 */
export function useConvexHealth(): ConvexHealth {
  const connectionState = useConvexConnectionState()

  return {
    isConnected: connectionState.isWebSocketConnected,
    hasEverConnected: connectionState.hasEverConnected,
  }
}
