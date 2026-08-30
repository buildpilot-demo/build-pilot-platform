import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-400">
        The page you're looking for doesn't exist.
      </p>
      <Link to="/dashboard" className="mt-4 inline-block underline">
        Back to dashboard
      </Link>
    </div>
  )
}
