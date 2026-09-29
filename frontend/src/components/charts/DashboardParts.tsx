import { formatMoney } from '../../lib/format'
import type { AnalyticsSummary } from '../../types/shop'

/**
 * One headline number with its change against the previous period. The change is written in
 * words and an arrow, never colour alone, and reads "no change" rather than a made-up percentage
 * when there is nothing to compare with.
 */
export function StatTile({
  label,
  value,
  current,
  previous,
  note,
  invert,
}: {
  label: string
  value: string
  current: number
  previous: number | null
  note?: string
  /** True when a rise is bad news (refunds). */
  invert?: boolean
}) {
  let change: { text: string; good: boolean | null } | null = null
  if (previous !== null) {
    if (previous === 0) change = current === 0 ? { text: 'No change', good: null } : { text: 'New this period', good: null }
    else {
      const pct = ((current - previous) / Math.abs(previous)) * 100
      const rounded = Math.abs(pct) < 0.05 ? 0 : pct
      change =
        rounded === 0
          ? { text: 'No change vs previous period', good: null }
          : { text: `${rounded > 0 ? '↑' : '↓'} ${Math.abs(rounded).toFixed(1)}% vs previous period`, good: invert ? rounded < 0 : rounded > 0 }
    }
  }
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border bg-white p-5">
      <p className="text-xs font-semibold text-text-secondary">{label}</p>
      <p className="font-display text-3xl font-bold tabular-nums">{value}</p>
      {change && <p className={`text-xs font-medium ${change.good === null ? 'text-text-secondary' : change.good ? 'text-success' : 'text-danger'}`}>{change.text}</p>}
      {note && <p className="text-xs text-text-secondary">{note}</p>}
    </div>
  )
}

/** Online against in-store as one bar with a 2px gap between them, the values beside it (never colour alone). */
export function ChannelSplit({ data, currency }: { data: AnalyticsSummary['byChannel']; currency: string }) {
  const money = (n: number) => formatMoney(n, currency)
  const total = data.reduce((s, c) => s + Math.max(0, c.netSales), 0)
  const label = { online: 'Online store', pos: 'In-store (POS)' } as const
  const swatch = { online: 'bg-series-online', pos: 'bg-series-pos' } as const
  return (
    <div className="flex flex-col gap-4">
      <div role="img" aria-label={data.map((c) => `${label[c.channel]} ${c.shareOfNetSales}% of net sales`).join(', ')} className="flex h-4 gap-[2px] overflow-hidden rounded-[4px] bg-bg">
        {total > 0 &&
          data.map((c) => (c.netSales > 0 ? <span key={c.channel} className={`block h-full ${swatch[c.channel]}`} style={{ width: `${(c.netSales / total) * 100}%` }} /> : null))}
      </div>
      <dl className="flex flex-col gap-3">
        {data.map((c) => (
          <div key={c.channel} className="flex items-start justify-between gap-3">
            <dt className="flex items-center gap-2 text-sm">
              <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-[3px] ${swatch[c.channel]}`} />
              {label[c.channel]}
            </dt>
            <dd className="text-right text-sm">
              <span className="font-semibold tabular-nums">{money(c.netSales)}</span>
              <span className="block text-xs text-text-secondary">
                {c.shareOfNetSales}% · {c.orders} {c.orders === 1 ? 'order' : 'orders'}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** Revenue per category as a ranked list: the bar is only revenue relative to the biggest category, the figures are written out. */
export function CategorySales({ categories, currency }: { categories: AnalyticsSummary['byCategory']; currency: string }) {
  const max = Math.max(1, ...categories.map((c) => c.revenue))
  const total = categories.reduce((s, c) => s + c.revenue, 0)
  return (
    <ol className="flex flex-col gap-3">
      {categories.map((c) => (
        <li key={c.category} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-semibold">{c.category}</span>
            <span className="shrink-0 text-text-secondary tabular-nums">
              {formatMoney(c.revenue, currency)} · {total > 0 ? Math.round((c.revenue / total) * 100) : 0}% · {c.unitsSold} sold
            </span>
          </div>
          <span className="h-2 overflow-hidden rounded-full bg-bg" aria-hidden="true">
            <span className="block h-full rounded-full bg-text-secondary/60" style={{ width: `${(c.revenue / max) * 100}%` }} />
          </span>
        </li>
      ))}
    </ol>
  )
}

/** The best sellers as a ranked list: the bar is only the units relative to the top seller, the numbers are written out. */
export function TopProducts({ products, currency }: { products: AnalyticsSummary['topProducts']; currency: string }) {
  const max = Math.max(1, ...products.map((p) => p.unitsSold))
  return (
    <ol className="flex flex-col gap-3">
      {products.map((p, i) => (
        <li key={p.productId} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              <span className="text-text-secondary">{i + 1}. </span>
              <span className="font-semibold">{p.title}</span>
            </span>
            <span className="shrink-0 text-text-secondary tabular-nums">
              {p.unitsSold} sold · {formatMoney(p.revenue, currency)}
            </span>
          </div>
          <span className="h-2 overflow-hidden rounded-full bg-bg" aria-hidden="true">
            <span className="block h-full rounded-full bg-text-secondary/60" style={{ width: `${(p.unitsSold / max) * 100}%` }} />
          </span>
        </li>
      ))}
    </ol>
  )
}
