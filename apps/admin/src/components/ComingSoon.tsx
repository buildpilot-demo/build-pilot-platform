interface ComingSoonProps {
  title: string
  description: string
}

/**
 * Shared placeholder rendered by pages that don't have real screen logic
 * yet. Delete the usage in a given page once that stage implements it.
 */
export function ComingSoon({ title, description }: ComingSoonProps) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-400">{description}</p>
      <p className="mt-4 text-sm font-medium text-slate-400 dark:text-slate-500">Coming soon</p>
    </div>
  )
}
