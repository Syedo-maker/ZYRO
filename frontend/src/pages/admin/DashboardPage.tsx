import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { OrderStatusBadge } from '../../components/OrderStatusBadge'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { SalesByDayChart } from '../../components/charts/SalesByDayChart'
import { ChannelSplit, StatTile, TopProducts } from '../../components/charts/DashboardParts'
import { formatDate, formatMoney } from '../../lib/format'
import { errorMessage, ordersApi } from '../../lib/ordersApi'
import { analyticsApi } from '../../lib/shopApi'
import type { Order } from '../../types/commerce'
import type { AnalyticsSummary } from '../../types/shop'

const PERIODS = [7, 30, 90] as const

/** The last `days` whole local days up to and including today, and the same length just before, as instants. */
function windows(days: number) {
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1 - days)
  const before = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1 - 2 * days)
  return { current: [start, end] as const, previous: [before, start] as const }
}

function Card({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={`rounded-2xl border border-border bg-white p-5 ${wide ? 'lg:col-span-2' : ''}`} aria-label={title}>
      <h2 className="mb-4 font-display text-base font-bold">{title}</h2>
      {children}
    </section>
  )
}

/** Sales at a glance: how much came in through each channel, how it moved, and what sold. */
export function DashboardPage() {
  const { activeStore } = useAuth()
  const storeId = activeStore?.id
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30)
  const [data, setData] = useState<{ now: AnalyticsSummary; before: AnalyticsSummary } | null>(null)
  const [recent, setRecent] = useState<Order[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!storeId) return
    const tz = -new Date().getTimezoneOffset()
    const w = windows(days)
    const [now, before] = await Promise.all([
      analyticsApi.summary(storeId, w.current[0], w.current[1], tz),
      analyticsApi.summary(storeId, w.previous[0], w.previous[1], tz),
    ])
    setData({ now, before })
  }, [storeId, days])

  useEffect(() => {
    setData(null)
    setError(null)
    load().catch((e) => setError(errorMessage(e, 'Could not load the dashboard.')))
  }, [load])

  useEffect(() => {
    if (!storeId) return
    ordersApi.list(storeId, { limit: 5 }).then((r) => setRecent(r.data)).catch(() => setRecent([]))
  }, [storeId])

  async function refresh() {
    setRefreshing(true)
    try {
      await load()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setRefreshing(false)
    }
  }

  if (!activeStore) return <p className="text-sm text-text-secondary">Create a store first.</p>
  const currency = data?.now.currency ?? 'USD'
  const money = (n: number) => formatMoney(n, currency)
  const t = data?.now.totals
  const p = data?.before.totals

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Dashboard</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {activeStore.name}
            {data && <> · updated {new Date(data.now.generatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}{data.now.cached ? ' (refreshes every 5 minutes)' : ''}</>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div role="group" aria-label="Period" className="flex overflow-hidden rounded-[10px] border border-border bg-white">
            {PERIODS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                aria-pressed={days === d}
                className={`h-10 px-4 text-sm font-semibold ${days === d ? 'bg-brand text-white' : 'hover:bg-bg'}`}
              >
                {d} days
              </button>
            ))}
          </div>
          <Button variant="secondary" className="h-10" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {!data && !error && <Spinner label="Loading the dashboard" />}

      {data && t && p && (
        <>
          <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Net sales" value={money(t.netSales)} current={t.netSales} previous={p.netSales} note={`${money(t.grossSales)} sold, ${money(t.refunds.total)} refunded`} />
            <StatTile label="Orders" value={String(t.orders)} current={t.orders} previous={p.orders} note={`${t.unitsSold} items`} />
            <StatTile label="Average order" value={money(t.averageOrderValue)} current={t.averageOrderValue} previous={p.averageOrderValue} />
            <StatTile label="Refunds" value={money(t.refunds.total)} current={t.refunds.total} previous={p.refunds.total} invert note={`${t.refunds.count} ${t.refunds.count === 1 ? 'refund' : 'refunds'}`} />
          </section>

          {t.orders === 0 && t.refunds.count === 0 ? (
            <p className="rounded-2xl border border-border bg-white px-6 py-12 text-center text-sm text-text-secondary">
              No sales in the last {days} days yet. Sales from your online store and your register will appear here.
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              <Card title={`Sales per day, last ${days} days`} wide>
                <SalesByDayChart daily={data.now.daily} currency={currency} />
              </Card>
              <Card title="Where sales come from">
                <ChannelSplit data={data.now.byChannel} currency={currency} />
              </Card>
              <Card title="Top products" wide>
                {data.now.topProducts.length === 0 ? <p className="text-sm text-text-secondary">No items sold in this period.</p> : <TopProducts products={data.now.topProducts} currency={currency} />}
              </Card>
              <Card title="Also this period">
                <dl className="flex flex-col gap-3 text-sm">
                  <div className="flex justify-between"><dt className="text-text-secondary">New customers</dt><dd className="font-semibold">{t.newCustomers}</dd></div>
                  <div className="flex justify-between"><dt className="text-text-secondary">Discounts given</dt><dd className="font-semibold">{money(t.discountsGiven)}</dd></div>
                  <div className="flex justify-between"><dt className="text-text-secondary">Tax collected</dt><dd className="font-semibold">{money(t.taxCollected)}</dd></div>
                  <div className="flex justify-between"><dt className="text-text-secondary">Product margin</dt><dd className="font-semibold">{t.costCoveragePercent > 0 ? money(t.productMargin) : 'No costs recorded'}</dd></div>
                  {t.costCoveragePercent > 0 && t.costCoveragePercent < 100 && (
                    <p className="text-xs text-text-secondary">Margin covers {t.costCoveragePercent}% of items sold; add costs to products for the rest.</p>
                  )}
                </dl>
              </Card>
            </div>
          )}
        </>
      )}

      <section aria-label="Recent orders" className="rounded-2xl border border-border bg-white p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-display text-base font-bold">Recent orders</h2>
          <Link to="/admin/orders" className="text-sm font-semibold text-brand hover:text-brand-hover">
            View all
          </Link>
        </div>
        {recent === null ? (
          <Spinner label="Loading orders" />
        ) : recent.length === 0 ? (
          <p className="text-sm text-text-secondary">No orders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-secondary">
                  <th scope="col" className="py-2 pr-4 font-semibold">Order</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Channel</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Date</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">Total</th>
                  <th scope="col" className="py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((o) => (
                  <tr key={o.id} className="border-t border-border">
                    <td className="py-2.5 pr-4 font-semibold">#{o.orderNumber}</td>
                    <td className="py-2.5 pr-4">{o.channel === 'pos' ? 'In-store' : 'Online'}</td>
                    <td className="py-2.5 pr-4 text-text-secondary">{formatDate(o.createdAt)}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{formatMoney(o.total, o.currency)}</td>
                    <td className="py-2.5"><OrderStatusBadge status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
