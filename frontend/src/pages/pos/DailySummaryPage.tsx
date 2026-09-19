import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { usePos } from '../../context/PosContext'
import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { errorMessage } from '../../lib/ordersApi'
import { formatDateTime, formatMoney } from '../../lib/format'
import { posApi } from '../../lib/posApi'
import type { PosDailyReport } from '../../types/pos'

/** Today as YYYY-MM-DD in the browser's own time zone (toISOString would give the UTC date). */
function localToday(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The local day as a [from, to) window; the server never has to guess the store's time zone. */
function dayWindow(date: string): [Date, Date] {
  const [y, m, d] = date.split('-').map(Number)
  return [new Date(y, m - 1, d), new Date(y, m - 1, d + 1)]
}

const METHOD_LABEL: Record<string, string> = { cash: 'Cash', card: 'Card', other: 'Other', stripe: 'Online card' }

export function DailySummaryPage() {
  const { storeId, session } = usePos()
  const [date, setDate] = useState(localToday)
  const [report, setReport] = useState<PosDailyReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const money = (n: number) => formatMoney(n, session.store.currency)

  useEffect(() => {
    if (!date || !session.permissions.analytics) return
    let cancelled = false
    setReport(null)
    setError(null)
    const [from, to] = dayWindow(date)
    posApi
      .dailyReport(storeId, from, to)
      .then((r) => {
        if (!cancelled) setReport(r)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [storeId, date, session.permissions.analytics])

  if (!session.permissions.analytics) return <Navigate to={`/pos/${storeId}`} replace />

  return (
    <div className="max-w-6xl mx-auto p-6 flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-xl font-bold">Daily summary</h1>
        <div className="flex items-end gap-3 print:hidden">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="summary-date" className="text-xs font-semibold text-text-secondary">
              Day
            </label>
            <input
              id="summary-date"
              type="date"
              value={date}
              max={localToday()}
              onChange={(e) => setDate(e.target.value)}
              className="h-11 rounded-[10px] border border-border bg-white px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <Button variant="secondary" onClick={() => window.print()} disabled={!report}>
            Print
          </Button>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {!report && !error && <Spinner label="Loading summary" />}

      {report && (
        <>
          <section aria-label="Totals" className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat label="Net sales" value={money(report.netSales)} strong />
            <Stat label="Gross sales" value={money(report.grossSales)} />
            <Stat label="Refunds" value={money(report.refunds.total)} note={`${report.refunds.count} paid back`} />
            <Stat label="Sales" value={String(report.salesCount)} note={report.salesCount ? `${money(report.averageSale)} average` : undefined} />
            <Stat label="Discounts given" value={money(report.discountsGiven)} note={`${money(report.taxCollected)} tax collected`} />
          </section>

          {report.salesCount === 0 && report.refunds.count === 0 && <p className="text-sm text-text-secondary">Nothing was sold at the register on this day.</p>}

          <div className="grid lg:grid-cols-2 gap-6">
            <Table title="By payment method" head={['Method', 'Sales', 'Refunds', 'Net']}>
              {report.byPaymentMethod.map((m) => (
                <tr key={m.method}>
                  <td>{METHOD_LABEL[m.method] ?? m.method}</td>
                  <td className="num">{money(m.sales)}</td>
                  <td className="num">{money(m.refunds)}</td>
                  <td className="num font-semibold">{money(m.net)}</td>
                </tr>
              ))}
            </Table>
            <Table title="By cashier" head={['Cashier', 'Sales', 'Refunds', 'Net']}>
              {report.byCashier.map((c) => (
                <tr key={c.userId ?? 'unknown'}>
                  <td>
                    {c.name} <span className="text-text-secondary">({c.salesCount})</span>
                  </td>
                  <td className="num">{money(c.sales)}</td>
                  <td className="num">{money(c.refunds)}</td>
                  <td className="num font-semibold">{money(c.net)}</td>
                </tr>
              ))}
            </Table>
            <Table title="Top items" head={['Item', 'Sold', 'Revenue']}>
              {report.topItems.map((i) => (
                <tr key={i.productId}>
                  <td>{i.title}</td>
                  <td className="num">{i.quantity}</td>
                  <td className="num font-semibold">{money(i.revenue)}</td>
                </tr>
              ))}
            </Table>
            <Table title="Shifts" head={['Opened by', 'Time', 'Expected', 'Counted', 'Difference']}>
              {report.shifts.map((s) => (
                <tr key={s.id}>
                  <td>{s.openedBy.name ?? 'Unknown'}</td>
                  <td>
                    {formatDateTime(s.openedAt)}
                    {s.status === 'open' && (
                      <>
                        {' '}
                        <Badge tone="success">Open</Badge>
                      </>
                    )}
                  </td>
                  <td className="num">{money(s.expectedCash)}</td>
                  <td className="num">{s.countedCash === null ? '-' : money(s.countedCash)}</td>
                  <td className={`num font-semibold ${s.variance !== null && s.variance < 0 ? 'text-danger' : ''}`}>
                    {s.variance === null ? '-' : s.variance === 0 ? 'Balanced' : money(s.variance)}
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${strong ? 'border-brand bg-brand-soft' : 'border-border bg-white'}`}>
      <div className="text-xs font-semibold text-text-secondary">{label}</div>
      <div className="font-display text-2xl font-bold tabular-nums mt-1">{value}</div>
      {note && <div className="text-xs text-text-secondary mt-0.5">{note}</div>}
    </div>
  )
}

function Table({ title, head, children }: { title: string; head: string[]; children: React.ReactNode }) {
  const rows = Array.isArray(children) ? children.length : children ? 1 : 0
  return (
    <section className="bg-white border border-border rounded-2xl overflow-x-auto [&_td]:px-4 [&_td]:py-2.5 [&_td.num]:text-right [&_td.num]:tabular-nums [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-xs [&_th]:font-semibold [&_th]:text-text-secondary [&_th]:text-left [&_tr:not(:last-child)]:border-b [&_tr]:border-border">
      <h2 className="font-display text-base font-bold px-4 pt-4">{title}</h2>
      <table className="w-full text-sm mt-2">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" className={i > 0 && h !== 'Time' ? '!text-right' : ''}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows === 0 ? (
            <tr>
              <td colSpan={head.length} className="text-text-secondary">
                None
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </section>
  )
}
