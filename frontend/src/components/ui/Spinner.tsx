export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-text-secondary">
      <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-brand" />
      {label}
    </span>
  )
}

/**
 * A placeholder in the shape of content that is still loading: a soft pulse, never a spinner in the
 * middle of a page. Size it with className (`h-4 w-40`, `h-32 w-full`).
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`block rounded-md bg-subtle motion-safe:animate-pulse ${className}`} />
}
