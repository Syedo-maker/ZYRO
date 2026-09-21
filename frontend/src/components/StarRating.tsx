const STAR = 'M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.5l-5.9 3.2 1.2-6.6L2.5 9.5l6.6-.9L12 2.5z'

function Row({ className }: { className: string }) {
  return (
    <span className="flex w-max shrink-0 gap-0.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path d={STAR} fill="currentColor" />
        </svg>
      ))}
    </span>
  )
}

/**
 * Stars for a rating from 0 to 5, filled to the exact fraction (4.2 fills 84%). The stars are
 * decoration: the accessible name says the rating in words, and the count sits beside them as text.
 */
export function StarRating({
  value,
  count,
  size = 'md',
  className = '',
}: {
  value: number | null | undefined
  /** When given, shown as "(128)" after the stars; 0 shows nothing but the empty stars. */
  count?: number
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const rating = Math.min(5, Math.max(0, value ?? 0))
  const px = size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-6 w-6' : 'h-4 w-4'
  const label = value == null ? 'No reviews yet' : `Rated ${rating.toFixed(1)} out of 5`
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span role="img" aria-label={label} className="relative inline-flex">
        <span className="text-border">
          <Row className={px} />
        </span>
        <span className="absolute inset-y-0 left-0 overflow-hidden text-star" style={{ width: `${(rating / 5) * 100}%` }}>
          <Row className={px} />
        </span>
      </span>
      {count !== undefined && count > 0 && <span className="text-xs text-text-secondary">({count})</span>}
    </span>
  )
}
