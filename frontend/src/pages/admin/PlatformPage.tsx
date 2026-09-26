import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../../context/AuthContext'
import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { formatPlanPrice, platformApi } from '../../lib/billingApi'
import { formatDate, formatMoney } from '../../lib/format'
import { errorMessage } from '../../lib/ordersApi'
import type { PlatformSummary, PlatformTenantRow } from '../../types/billing'
import type { PaginationInfo } from '../../types/api'

const PAGE = 15

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <p className="text-xs font-semibold text-text-secondary">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold">{value}</p>
      {note && <p className="mt-1 text-xs text-text-secondary">{note}</p>}
    </div>
  )
}

/**
 * The platform operator's view: how many stores there are, what they pay and how much AI they use,
 * as per-store totals. It shows no customer data at all (no shoppers, emails or order contents),
 * only counts and sums. Reachable only by a super administrator; anyone else is told it is not for them.
 */
export function PlatformPage() {
  const { user } = useAuth()
  const [summary, setSummary] = useState<PlatformSummary | null>(null)
  const [rows, setRows] = useState<PlatformTenantRow[] | null>(null)
  const [pagination, setPagination] = useState<PaginationInfo | null>(null)
  const [query, setQuery] = useState('')
  const [applied, setApplied] = useState('')
  const [offset, setOffset] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const admin = user?.platformAdmin === true

  useEffect(() => {
    if (!admin) return
    platformApi.summary().then(setSummary).catch((e) => setError(errorMessage(e, 'Could not load the platform summary.')))
  }, [admin])

  const loadRows = useCallback(async () => {
    const r = await platformApi.tenants({ q: applied || undefined, limit: PAGE, offset })
    setRows(r.data)
    setPagination(r.pagination)
  }, [applied, offset])

  useEffect(() => {
    if (!admin) return
    loadRows().catch((e) => setError(errorMessage(e, 'Could not load the stores.')))
  }, [admin, loadRows])

  if (!admin) return <Alert tone="info">This page is for the platform operators.</Alert>

  function search(e: FormEvent) {
    e.preventDefault()
    setOffset(0)
    setApplied(query.trim())
  }

  return (
    <div className="flex max-w-6xl flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-bold">Platform</h1>
        <p className="mt-1 text-sm text-text-secondary">Per-store totals only. No customer data is shown here.</p>
      </div>
      {error && <Alert>{error}</Alert>}
      {!summary && !error && <Spinner label="Loading the platform summary" />}

      {summary && (
        <>
          <section aria-label="Platform totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Stores" value={String(summary.stores)} note={Object.entries(summary.storesByPlan).map(([tier, n]) => `${n} ${tier.toLowerCase()}`).join(', ')} />
            <Tile label="Monthly recurring revenue" value={formatMoney(summary.monthlyRecurringRevenue, 'USD')} note="From plans currently paid for" />
            <Tile label="Orders taken" value={summary.orders.toLocaleString()} note="Online and register, all stores" />
            <Tile label="AI used this month" value={`${summary.aiUsageThisMonth.generations + summary.aiUsageThisMonth.chatMessages}`} note={`${summary.aiUsageThisMonth.generations} generations, ${summary.aiUsageThisMonth.chatMessages} assistant replies`} />
          </section>

          <section aria-label="Plan economics" className="rounded-2xl border border-border bg-white p-5">
            <h2 className="font-display text-base font-bold">Are the prices above the worst case cost?</h2>
            <p className="mt-1 text-xs text-text-secondary">
              Each plan and pack against the most it could cost in a month if every AI call used its full size limit, plus servers and Stripe fees. Real cost is far lower.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-text-secondary">
                    <th scope="col" className="py-2 pr-4 font-semibold">Plan or pack</th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">Price</th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">Worst case cost</th>
                    <th scope="col" className="py-2 font-semibold">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.economics.map((e) => (
                    <tr key={e.id} className="border-t border-border">
                      <td className="py-2.5 pr-4 font-semibold capitalize">{e.id.toLowerCase()}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{e.priceUsd === 0 ? 'Free' : formatPlanPrice(Math.round(e.priceUsd * 100), 'usd')}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{formatPlanPrice(Math.round(e.worstCaseCostUsd * 100), 'usd')}</td>
                      <td className="py-2.5">
                        {e.priceUsd === 0 ? <Badge tone="neutral">Free plan</Badge> : <Badge tone={e.profitable ? 'success' : 'danger'}>{e.profitable ? 'Above cost' : 'Below cost'}</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section aria-label="Stores" className="rounded-2xl border border-border bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base font-bold">Stores</h2>
          <form onSubmit={search} className="flex gap-2">
            <input
              aria-label="Search stores"
              placeholder="Store name or address"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 rounded-[10px] border border-border bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
            <Button type="submit" variant="secondary" className="h-10">
              Search
            </Button>
          </form>
        </div>
        {!rows ? (
          <Spinner label="Loading stores" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-text-secondary">No stores match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-secondary">
                  <th scope="col" className="py-2 pr-4 font-semibold">Store</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Plan</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Since</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">Products</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">Orders</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">Sales</th>
                  <th scope="col" className="py-2 text-right font-semibold">AI this month</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="py-2.5 pr-4">
                      <span className="font-semibold">{t.name}</span> <span className="text-xs text-text-secondary">{t.slug}</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={t.plan === 'Free' ? 'neutral' : 'success'}>{t.plan}</Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-text-secondary">{formatDate(t.createdAt)}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{t.products}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{t.orders}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{formatMoney(t.grossSales, t.currency)}</td>
                    <td className="py-2.5 text-right tabular-nums">
                      {t.aiGenerationsUsed} + {t.aiChatMessagesUsed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pagination && pagination.total > PAGE && (
          <div className="mt-4 flex items-center justify-between text-sm text-text-secondary">
            <span>
              {offset + 1} to {Math.min(offset + PAGE, pagination.total)} of {pagination.total}
            </span>
            <span className="flex gap-2">
              <Button variant="secondary" className="h-9" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                Previous
              </Button>
              <Button variant="secondary" className="h-9" disabled={offset + PAGE >= pagination.total} onClick={() => setOffset(offset + PAGE)}>
                Next
              </Button>
            </span>
          </div>
        )}
      </section>
    </div>
  )
}
