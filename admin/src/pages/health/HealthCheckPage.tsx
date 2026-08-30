import { useConvexHealth } from '../../hooks/useConvexHealth'

/**
 * Minimal page used to smoke-test Firebase Hosting deploys: confirms the
 * static bundle served and rendered, and reports whether the Convex client
 * has an address configured and is reaching the deployment.
 */
export function HealthCheckPage() {
  const { isConnected } = useConvexHealth()

  return (
    <div data-testid="health-check">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">OK</h1>
      <ul className="mt-2 space-y-1 text-slate-600 dark:text-slate-300">
        <li>Frontend: rendered</li>
        <li>
          Convex connection:{' '}
          <span data-testid="convex-status">{isConnected ? 'connected' : 'connecting'}</span>
        </li>
      </ul>
    </div>
  )
}
