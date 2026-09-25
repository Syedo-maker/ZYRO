import { useEffect, useState } from 'react'
import { aiUsageApi } from '../../lib/aiContentApi'
import type { AiUsageQuota } from '../../types/shop'

/** "1 October": the quota rows are keyed by UTC month ("2026-09"), so the reset is the 1st of the next UTC month. */
function resetDate(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 1)).toLocaleDateString(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 1
  const exhausted = used >= limit
  const nearly = !exhausted && ratio >= 0.8
  // The state is spelled out in words as well as colored, so it does not depend on seeing the color.
  const status = exhausted ? 'Limit reached' : nearly ? 'Almost used up' : null
  const fill = exhausted ? 'bg-danger' : nearly ? 'bg-warning' : 'bg-brand'
  const tone = exhausted ? 'text-danger' : nearly ? 'text-warning' : 'text-text-secondary'
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold">{label}</span>
        <span className="tabular-nums text-text-secondary">
          {used} of {limit} used
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        aria-valuetext={`${used} of ${limit} used`}
        className="h-2 overflow-hidden rounded-full bg-border"
      >
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      {status && <p className={`text-xs font-semibold ${tone}`}>{status}</p>}
    </div>
  )
}

/**
 * How much of this month's AI allowance the store has used: content tools (descriptions, tags,
 * summaries, marketing copy, insights, recovery emails) and the shopping assistant's chat replies
 * are counted separately (Implementation_Plan.md Phase 4). Only staff who may use the AI tools can
 * read the figures; for anyone else, or if the request fails, the meter is simply not shown,
 * because a missing bonus panel is better than an error on the dashboard.
 */
export function AiUsageMeter({ storeId }: { storeId: string }) {
  const [usage, setUsage] = useState<AiUsageQuota | null>(null)

  useEffect(() => {
    let cancelled = false
    setUsage(null)
    aiUsageApi
      .get(storeId)
      .then((u) => !cancelled && setUsage(u))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [storeId])

  if (!usage) return null
  return (
    <section aria-label="AI usage this month" className="rounded-2xl border border-border bg-white p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-bold">AI usage this month</h2>
        <p className="text-xs text-text-secondary">Resets on {resetDate(usage.month)}</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Meter label="AI content generations" used={usage.generationsUsed} limit={usage.generationsLimit} />
        <Meter label="Shopping assistant replies" used={usage.chatMessagesUsed} limit={usage.chatMessagesLimit} />
      </div>
    </section>
  )
}
