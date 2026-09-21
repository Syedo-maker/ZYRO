import { useId, useState } from 'react'
import { formatMoney } from '../../lib/format'
import type { AnalyticsSummary } from '../../types/shop'

type Day = AnalyticsSummary['daily'][number]

const HEIGHT = 220
const MAX_BAR = 24
const GAP = 2

/** A round top for the y axis: 1, 2, 2.5, 5 or 10 times a power of ten. */
export function niceMax(value: number): number {
  if (value <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(value))
  const n = value / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return step * pow
}

const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)

/**
 * Sales per day, online and in-store stacked (part to whole). Follows the dataviz rules: thin
 * columns (24px at most) with a rounded data end, a 2px gap between the two segments, hairline
 * grid, two series with a legend, values in a hover/focus tooltip rather than on every column,
 * and a table view of exactly the same numbers.
 */
export function SalesByDayChart({ daily, currency }: { daily: Day[]; currency: string }) {
  const [active, setActive] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const tableId = useId()
  const totals = daily.map((d) => d.online.grossSales + d.pos.grossSales)
  const top = niceMax(Math.max(0, ...totals))
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top)
  const step = Math.max(1, Math.ceil(daily.length / 6))
  const money = (n: number) => formatMoney(n, currency)
  const height = (n: number) => Math.round((n / top) * HEIGHT)

  if (table) {
    return (
      <div>
        <div className="mb-3 flex justify-end">
          <button onClick={() => setTable(false)} className="text-sm font-semibold text-brand hover:text-brand-hover">
            View as chart
          </button>
        </div>
        <div className="max-h-[300px] overflow-auto rounded-[10px] border border-border">
          <table id={tableId} className="w-full text-sm">
            <caption className="sr-only">Gross sales per day by channel</caption>
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-xs text-text-secondary">
                <th scope="col" className="px-3 py-2 font-semibold">Day</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Online</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">In-store</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((d, i) => (
                <tr key={d.date} className="border-t border-border">
                  <th scope="row" className="px-3 py-1.5 text-left font-normal">{shortDate(d.date)}</th>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(d.online.grossSales)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(d.pos.grossSales)}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{money(totals[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const hovered = active === null ? null : daily[active]
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <ul className="flex gap-4 text-xs text-text-secondary" aria-label="Legend">
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px] bg-series-online" /> Online
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px] bg-series-pos" /> In-store
          </li>
        </ul>
        <button onClick={() => setTable(true)} className="text-sm font-semibold text-brand hover:text-brand-hover" aria-controls={tableId}>
          View as table
        </button>
      </div>

      <div className="relative pl-12" style={{ height: HEIGHT + 28 }}>
        {ticks.map((t) => (
          <div key={t} className="absolute inset-x-0 border-t border-border" style={{ bottom: 28 + (t / top) * HEIGHT }}>
            <span className="absolute -top-2 left-0 w-10 text-right text-[11px] text-text-secondary tabular-nums">{compact(t)}</span>
          </div>
        ))}

        <ul className="absolute bottom-7 left-12 right-0 flex items-end" style={{ height: HEIGHT }} onMouseLeave={() => setActive(null)}>
          {daily.map((d, i) => {
            const online = height(d.online.grossSales)
            const pos = height(d.pos.grossSales)
            return (
              <li key={d.date} className="relative flex h-full flex-1 items-end justify-center">
                <button
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  aria-label={`${shortDate(d.date)}: online ${money(d.online.grossSales)}, in-store ${money(d.pos.grossSales)}, total ${money(totals[i])}`}
                  className="flex h-full w-full items-end justify-center outline-offset-[-2px]"
                >
                  <span className="flex w-[70%] flex-col-reverse items-stretch" style={{ maxWidth: MAX_BAR, gap: online && pos ? GAP : 0 }}>
                    {online > 0 && <span className={`block bg-series-online ${pos ? '' : 'rounded-t-[4px]'}`} style={{ height: Math.max(online, 2) }} />}
                    {pos > 0 && <span className="block rounded-t-[4px] bg-series-pos" style={{ height: Math.max(pos, 2) }} />}
                  </span>
                </button>
                {i % step === 0 && (
                  <span className="pointer-events-none absolute -bottom-6 whitespace-nowrap text-[11px] text-text-secondary">{shortDate(d.date)}</span>
                )}
              </li>
            )
          })}
        </ul>

        {hovered && active !== null && (
          <div className="pointer-events-none absolute bottom-7 left-12 right-0 top-0">
            <div
              role="tooltip"
              className="absolute top-0 z-10 w-44 rounded-[10px] border border-border bg-white p-3 text-xs"
              style={{ left: `${((active + 0.5) / daily.length) * 100}%`, transform: `translateX(${active > daily.length / 2 ? 'calc(-100% - 12px)' : '12px'})` }}
            >
              <p className="mb-1.5 font-semibold">{shortDate(hovered.date)}</p>
              <p className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 rounded-[2px] bg-series-online" /> Online</span>
                <span className="tabular-nums">{money(hovered.online.grossSales)}</span>
              </p>
              <p className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 rounded-[2px] bg-series-pos" /> In-store</span>
                <span className="tabular-nums">{money(hovered.pos.grossSales)}</span>
              </p>
              <p className="mt-1.5 flex justify-between gap-2 border-t border-border pt-1.5 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{money(totals[active])}</span>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
