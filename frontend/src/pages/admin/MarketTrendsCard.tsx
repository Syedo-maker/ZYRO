import { useEffect, useState } from 'react'
import { trendsApi, type StoreTrends, type TrendReport } from '../../lib/trendsApi'

const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** One category's report: each line with the numbers of the sources it rests on, and the sources listed below. */
function Report({ report }: { report: TrendReport }) {
  if (report.status === 'suppressed') {
    return <p className="text-sm text-text-secondary">Not enough stores sell in this category yet for a report that keeps every store anonymous.</p>
  }
  if (report.status === 'no_data') return <p className="text-sm text-text-secondary">No data this week.</p>

  const number = new Map(report.facts.map((f, i) => [f.id, i + 1]))
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1.5">
        {report.lines.map((l, i) => (
          <li key={i} className="text-sm leading-relaxed">
            {l.text}{' '}
            {l.cites.map((c) => (
              <sup key={c} className="ml-0.5 font-semibold text-brand" aria-label={`source ${number.get(c)}`}>
                [{number.get(c)}]
              </sup>
            ))}
          </li>
        ))}
      </ul>
      <details className="text-xs text-text-secondary">
        <summary className="cursor-pointer font-semibold">Sources</summary>
        <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5">
          {report.facts.map((f) => (
            <li key={f.id}>
              {f.source}, to {shortDate(f.date)}.{' '}
              {f.url && (
                <a href={f.url} target="_blank" rel="noreferrer" className="font-semibold text-brand hover:text-brand-hover">
                  Open
                </a>
              )}
            </li>
          ))}
        </ol>
      </details>
    </div>
  )
}

/**
 * Market trends on the dashboard (Part D): the weekly report for each of the store's main categories,
 * shared by every store selling in them. Figures are anonymised totals across stores, and every line
 * shows which source it comes from. Hidden for anyone who cannot read the store's figures.
 */
export function MarketTrendsCard({ storeId }: { storeId: string }) {
  const [data, setData] = useState<StoreTrends | null>(null)

  useEffect(() => {
    trendsApi.forStore(storeId).then(setData).catch(() => setData(null))
  }, [storeId])

  if (!data || data.categories.length === 0) return null
  const week = data.categories.find((c) => c.report)?.report?.covers

  return (
    <section aria-label="Market trends" className="rounded-2xl border border-border bg-white p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-bold">Market trends</h2>
        <p className="text-xs text-text-secondary">
          {week ? `Week of ${shortDate(week.from)} to ${shortDate(week.to)}, ` : ''}anonymised totals across {data.market} stores, and public search trends
        </p>
      </div>
      <div className={`grid gap-5 ${data.categories.length > 1 ? 'lg:grid-cols-2' : ''}`}>
        {data.categories.map((c) => (
          <div key={c.category} className="flex flex-col gap-2">
            <h3 className="text-sm font-bold">{c.name}</h3>
            {c.report ? <Report report={c.report} /> : <p className="text-sm text-text-secondary">The first report arrives on Monday.</p>}
          </div>
        ))}
      </div>
    </section>
  )
}
