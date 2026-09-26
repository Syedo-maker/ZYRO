/**
 * One allowance as a labelled bar: "7 of 50 used". The bar turns amber at 80 percent and red at the
 * limit, and the state is also written in words ("Almost used up", "Limit reached") so it does not
 * depend on seeing the color. It is a real `progressbar` with its value for screen readers.
 */
export function UsageBar({ label, used, limit, unit = 'used' }: { label: string; used: number; limit: number; unit?: string }) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 1
  const exhausted = used >= limit
  const nearly = !exhausted && ratio >= 0.8
  const status = exhausted ? 'Limit reached' : nearly ? 'Almost used up' : null
  const fill = exhausted ? 'bg-danger' : nearly ? 'bg-warning' : 'bg-brand'
  const tone = exhausted ? 'text-danger' : 'text-warning'
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold">{label}</span>
        <span className="tabular-nums text-text-secondary">
          {used} of {limit} {unit}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        aria-valuetext={`${used} of ${limit} ${unit}`}
        className="h-2 overflow-hidden rounded-full bg-border"
      >
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      {status && <p className={`text-xs font-semibold ${tone}`}>{status}</p>}
    </div>
  )
}
