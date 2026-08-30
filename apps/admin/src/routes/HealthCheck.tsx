import { useConvexConnectionState } from 'convex/react'

/**
 * Minimal route used to smoke-test Firebase Hosting deploys: confirms the
 * static bundle served and rendered, and reports whether the Convex client
 * has an address configured and is reaching the deployment.
 */
export function HealthCheck() {
  const connectionState = useConvexConnectionState()

  return (
    <main data-testid="health-check" style={{ padding: '2rem' }}>
      <h1>OK</h1>
      <ul>
        <li>Frontend: rendered</li>
        <li>
          Convex connection:{' '}
          <span data-testid="convex-status">
            {connectionState.isWebSocketConnected ? 'connected' : 'connecting'}
          </span>
        </li>
      </ul>
    </main>
  )
}
