/** Placeholder cards while a product grid loads: keeps the layout still and says so to screen readers. */
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-busy="true" aria-label="Loading products">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-3">
          <div className="aspect-[4/3] animate-pulse rounded-[10px] bg-bg" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-bg" />
          <div className="h-4 w-1/3 animate-pulse rounded bg-bg" />
          <div className="h-10 animate-pulse rounded-[10px] bg-bg" />
        </li>
      ))}
    </ul>
  )
}
