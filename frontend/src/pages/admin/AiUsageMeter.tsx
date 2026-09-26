import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { UsageBar } from '../../components/billing/UsageBar'
import { aiUsageApi } from '../../lib/aiContentApi'
import type { AiUsageQuota } from '../../types/shop'

/** "1 October": the quota rows are keyed by UTC month ("2026-09"), so the reset is the 1st of the next UTC month. */
function resetDate(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 1)).toLocaleDateString(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

/**
 * How much of this month's AI allowance the store has used: content tools (descriptions, tags,
 * summaries, marketing copy, insights, recovery emails) and the shopping assistant's chat replies
 * are counted separately (Implementation_Plan.md Phase 4). It also shows the plan the allowance
 * comes from and any bought top-up credits, and links the owner to buy more. Only people who may
 * use the AI tools can read the figures; for anyone else, or if the request fails, the meter is
 * simply not shown, because a missing bonus panel is better than an error on the dashboard.
 */
export function AiUsageMeter({ storeId, isOwner = false }: { storeId: string; isOwner?: boolean }) {
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
  const credits = usage.topUpGenerations + usage.topUpChatMessages
  return (
    <section aria-label="AI usage this month" className="rounded-2xl border border-border bg-white p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-bold">
          AI usage this month <span className="ml-1 text-xs font-semibold text-text-secondary">{usage.plan} plan</span>
        </h2>
        <p className="text-xs text-text-secondary">Resets on {resetDate(usage.month)}</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <UsageBar label="AI content generations" used={usage.generationsUsed} limit={usage.generationsLimit} />
        <UsageBar label="Shopping assistant replies" used={usage.chatMessagesUsed} limit={usage.chatMessagesLimit} />
      </div>
      {(credits > 0 || isOwner) && (
        <p className="mt-4 flex flex-wrap items-center gap-x-3 text-xs text-text-secondary">
          {credits > 0 && (
            <span>
              Bought credits left: {usage.topUpGenerations} generations, {usage.topUpChatMessages} replies (used after the monthly allowance)
            </span>
          )}
          {isOwner && (
            <Link to="/admin/billing" className="font-semibold text-brand hover:text-brand-hover">
              Plans and AI packs
            </Link>
          )}
        </p>
      )}
    </section>
  )
}
