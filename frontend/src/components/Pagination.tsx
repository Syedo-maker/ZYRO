import { Link } from 'react-router-dom'

/** The page numbers to show: the first, the last, and a window around the current page, with gaps as null. */
export function pageWindow(current: number, total: number): (number | null)[] {
  const pages = new Set<number>([1, total, current - 1, current, current + 1])
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)
  const out: (number | null)[] = []
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push(null)
    out.push(p)
  })
  return out
}

/** Numbered pages as real links, so each page has its own address and works with the back button. */
export function Pagination({ page, pageCount, hrefFor }: { page: number; pageCount: number; hrefFor: (page: number) => string }) {
  if (pageCount <= 1) return null
  const item = 'inline-flex h-10 min-w-10 items-center justify-center rounded-[10px] border px-3 text-sm font-semibold'
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-center gap-2">
      {page > 1 && (
        <Link to={hrefFor(page - 1)} className={`${item} border-border bg-white hover:bg-bg`}>
          Previous
        </Link>
      )}
      {pageWindow(page, pageCount).map((p, i) =>
        p === null ? (
          <span key={`gap${i}`} aria-hidden="true" className="px-1 text-text-muted">
            ...
          </span>
        ) : (
          <Link
            key={p}
            to={hrefFor(p)}
            aria-label={`Page ${p}`}
            aria-current={p === page ? 'page' : undefined}
            className={`${item} ${p === page ? 'border-brand bg-brand text-white' : 'border-border bg-white hover:bg-bg'}`}
          >
            {p}
          </Link>
        )
      )}
      {page < pageCount && (
        <Link to={hrefFor(page + 1)} className={`${item} border-border bg-white hover:bg-bg`}>
          Next
        </Link>
      )}
    </nav>
  )
}
