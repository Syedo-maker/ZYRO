import { useEffect, useState } from 'react'
import { CategorySales } from '../../components/charts/DashboardParts'
import { analyticsApi, cartRecoveryApi } from '../../lib/shopApi'
import type { AnalyticsSummary, CartRecoveryPerformance } from '../../types/shop'

const DAYS = 30

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-2xl border border-border bg-white p-5">
      <h2 className="mb-4 font-display text-base font-bold">{title}</h2>
      {children}
    </section>
  )
}

/** One step of the recovery funnel: a count, and its share of emails sent. */
function Step({ label, value, sent, note }: { label: string; value: number | null; sent: number; note?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-semibold text-text-secondary">{label}</dt>
      <dd className="font-display text-2xl font-bold tabular-nums">
        {value === null ? <span className="text-base font-semibold text-text-secondary">Not tracked</span> : value}
        {value !== null && sent > 0 && label !== 'Sent' && <span className="ml-1.5 text-sm font-semibold text-text-secondary">({Math.round((value / sent) * 100)}%)</span>}
      </dd>
      {note && <p className="text-xs text-text-secondary">{note}</p>}
    </div>
  )
}

/**
 * The two marketing figures from the AdminMarketing wireframe: how the abandoned-cart recovery
 * emails are converting, and sales by category over the last 30 days. Both need the analytics
 * permission; for anyone without it (or if a request fails) the card is simply left out.
 * Opens and clicks are shown as "Not tracked" rather than 0, because no email tracking exists yet.
 */
export function MarketingInsights({ storeId }: { storeId: string }) {
  const [recovery, setRecovery] = useState<CartRecoveryPerformance | null>(null)
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    cartRecoveryApi
      .performance(storeId)
      .then((r) => !cancelled && setRecovery(r))
      .catch(() => undefined)
    const now = new Date()
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1 - DAYS)
    analyticsApi
      .summary(storeId, from, to, -now.getTimezoneOffset())
      .then((s) => !cancelled && setSummary(s))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [storeId])

  if (!recovery && !summary) return null
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {recovery && (
        <Card title="Abandoned-cart recovery">
          {recovery.sent === 0 ? (
            <p className="text-sm text-text-secondary">No recovery emails sent yet. When a signed-in shopper leaves items in their cart, a reminder is sent automatically.</p>
          ) : (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Step label="Sent" value={recovery.sent} sent={recovery.sent} />
              <Step label="Opened" value={null} sent={recovery.sent} />
              <Step label="Clicked" value={null} sent={recovery.sent} />
              <Step label="Converted" value={recovery.converted} sent={recovery.sent} note="placed an order afterwards" />
            </dl>
          )}
        </Card>
      )}
      {summary && (
        <Card title={`Sales by category, last ${DAYS} days`}>
          {summary.byCategory.length === 0 ? (
            <p className="text-sm text-text-secondary">No sales in the last {DAYS} days yet.</p>
          ) : (
            <CategorySales categories={summary.byCategory} currency={summary.currency} />
          )}
        </Card>
      )}
    </div>
  )
}
