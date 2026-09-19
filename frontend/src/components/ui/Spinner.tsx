export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-text-secondary">
      <span
        aria-hidden="true"
        className="h-4 w-4 rounded-full border-2 border-border border-t-brand animate-spin"
      />
      {label}
    </span>
  )
}
