import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { UsageBar } from '../../components/billing/UsageBar'
import { billingApi, formatPlanPrice } from '../../lib/billingApi'
import { formatDate } from '../../lib/format'
import { errorMessage } from '../../lib/ordersApi'
import type { BillingOverview, PlanInfo } from '../../types/billing'

const POLL_MS = 2000
const POLL_TRIES = 15

/** One line of what a plan includes. */
function features(p: PlanInfo): string[] {
  return [
    `Up to ${p.maxProducts.toLocaleString()} products`,
    `${p.maxStaff} staff ${p.maxStaff === 1 ? 'account' : 'accounts'}`,
    `${p.aiGenerationsPerMonth} AI generations a month`,
    `${p.aiChatMessagesPerMonth} assistant replies a month`,
    `Sales reports up to ${p.analyticsMaxDays} days`,
    p.customDomain ? 'Your own domain name' : 'No custom domain',
  ]
}

/**
 * The owner's page for the plan and what it costs: which plan the store is on, how much of each
 * limit it has used, the plans to move to, and one-off AI packs. Buying always goes through
 * Stripe's own page; coming back from it, this page waits for Stripe's confirmation (which is
 * what actually changes the plan, on the server) rather than trusting the browser's return.
 */
export function BillingPage() {
  const { activeStore } = useAuth()
  const storeId = activeStore?.id
  const isOwner = activeStore?.role === 'owner'
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState<BillingOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'info' | 'success' | 'error'; text: string } | null>(null)
  const startTopUp = useRef<number | null>(null)

  const load = useCallback(async () => {
    if (!storeId || !isOwner) return null
    const overview = await billingApi.overview(storeId)
    setData(overview)
    return overview
  }, [storeId, isOwner])

  useEffect(() => {
    load().catch((e) => setError(errorMessage(e, 'Could not load your plan.')))
  }, [load])

  // Coming back from Stripe: wait for the confirmation to land, then show the result.
  const checkout = params.get('checkout')
  const topup = params.get('topup')
  useEffect(() => {
    if (!storeId || !isOwner) return
    if (checkout === 'cancelled' || topup === 'cancelled') {
      setNotice({ tone: 'info', text: 'Checkout was cancelled. Nothing was charged.' })
      setParams({}, { replace: true })
      return
    }
    if (checkout !== 'success' && topup !== 'success') return
    let cancelled = false
    setNotice({ tone: 'info', text: 'Payment received. Confirming with Stripe, this takes a few seconds...' })
    void (async () => {
      const first = await billingApi.overview(storeId).catch(() => null)
      startTopUp.current = first ? first.topUp.generations + first.topUp.chatMessages : null
      for (let i = 0; i < POLL_TRIES && !cancelled; i++) {
        const now = await billingApi.overview(storeId).catch(() => null)
        if (cancelled) return
        if (now) setData(now)
        const done =
          checkout === 'success'
            ? now?.plan.tier !== 'FREE'
            : now && startTopUp.current !== null && now.topUp.generations + now.topUp.chatMessages > startTopUp.current
        if (done && now) {
          setNotice({ tone: 'success', text: checkout === 'success' ? `You are now on the ${now.plan.name} plan.` : 'Your AI credits were added.' })
          setParams({}, { replace: true })
          return
        }
        await new Promise((r) => setTimeout(r, POLL_MS))
      }
      if (!cancelled) {
        setNotice({
          tone: 'info',
          text: 'We have not received Stripe’s confirmation yet. If you paid, it will appear here shortly; refresh this page in a minute.',
        })
        setParams({}, { replace: true })
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per return from Stripe
  }, [storeId, isOwner, checkout, topup])

  async function go(name: string, action: () => Promise<{ url: string }>) {
    setBusy(name)
    setError(null)
    try {
      const { url } = await action()
      window.location.assign(url)
    } catch (e) {
      setError(errorMessage(e, 'Could not start the payment.'))
      setBusy(null)
    }
  }

  if (!activeStore) return <p className="text-sm text-text-secondary">Create a store first.</p>
  if (!isOwner) return <Alert tone="info">Only the store owner can see plans and billing.</Alert>
  if (!data) return error ? <Alert>{error}</Alert> : <Spinner label="Loading your plan" />

  const { plan, usage, plans, topUpPacks, topUp, currency, billingConfigured } = data
  const onFree = plan.tier === 'FREE'

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-bold">Plan and billing</h1>
        <p className="mt-1 text-sm text-text-secondary">{activeStore.name}</p>
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone={notice.tone === 'error' ? 'error' : notice.tone}>{notice.text}</Alert>}
      {!billingConfigured && <Alert tone="info">Payments are not set up on this server yet, so plans and packs cannot be bought. You can still see what each includes.</Alert>}

      <section aria-label="Your plan" className="rounded-2xl border border-border bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-lg font-bold">{plan.name} plan</h2>
            <Badge tone={onFree ? 'neutral' : plan.status === 'grace' ? 'warning' : 'success'}>
              {onFree ? 'Free' : plan.status === 'grace' ? 'Renewal pending' : 'Active'}
            </Badge>
          </div>
          {plan.canManageSubscription && (
            <Button variant="secondary" className="h-10" disabled={busy !== null} onClick={() => void go('portal', () => billingApi.portal(activeStore.id))}>
              {busy === 'portal' ? 'Opening...' : 'Manage subscription'}
            </Button>
          )}
        </div>
        {plan.paidUntil && !onFree && (
          <p className="mb-4 text-sm text-text-secondary">
            {plan.status === 'grace' ? 'Your last payment period ended ' : 'Paid until '}
            {formatDate(plan.paidUntil)}. It renews automatically unless you cancel in Manage subscription.
          </p>
        )}
        {plan.lapsedFrom && (
          <div className="mb-4">
            <Alert tone="info">
              Your {plan.lapsedFrom} plan has ended, so this store is back on Free. Nothing was deleted; you just cannot add more than the Free plan allows until you choose a plan again.
            </Alert>
          </div>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <UsageBar label="Products" used={usage.products.used} limit={usage.products.limit} unit="used" />
          <UsageBar label="Staff accounts" used={usage.staff.used} limit={usage.staff.limit} unit="used" />
          <UsageBar label="AI generations this month" used={usage.aiGenerations.used} limit={usage.aiGenerations.limit} />
          <UsageBar label="Assistant replies this month" used={usage.aiChatMessages.used} limit={usage.aiChatMessages.limit} />
        </div>
      </section>

      <section aria-label="Plans" className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-bold">Plans</h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {plans.map((p) => {
            const current = p.tier === plan.tier
            const price = p.priceCents === 0 ? 'Free' : `${formatPlanPrice(p.priceCents, currency)}/month`
            return (
              <li key={p.tier}>
                <section aria-label={`${p.name} plan`} className={`flex h-full flex-col gap-4 rounded-2xl border bg-white p-5 ${current ? 'border-brand' : 'border-border'}`}>
                  <div>
                    <h3 className="font-display text-base font-bold">{p.name}</h3>
                    <p className="mt-1 font-display text-2xl font-bold">{price}</p>
                  </div>
                  <ul className="flex flex-1 flex-col gap-1.5 text-sm text-text-secondary">
                    {features(p).map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  {current ? (
                    <Button variant="secondary" disabled>
                      Your plan
                    </Button>
                  ) : p.tier === 'FREE' ? null : onFree ? (
                    <Button disabled={!billingConfigured || busy !== null} onClick={() => void go(p.tier, () => billingApi.subscribe(activeStore.id, p.tier as 'PRO' | 'BUSINESS'))}>
                      {busy === p.tier ? 'Opening...' : `Choose ${p.name}`}
                    </Button>
                  ) : (
                    <p className="text-xs text-text-secondary">To change plan, cancel in Manage subscription, then choose the new plan when the current one ends.</p>
                  )}
                </section>
              </li>
            )
          })}
        </ul>
      </section>

      <section aria-label="AI packs" className="flex flex-col gap-4">
        <div>
          <h2 className="font-display text-lg font-bold">Extra AI credits</h2>
          <p className="mt-1 text-sm text-text-secondary">
            One-off packs, on any plan. They are used only after your monthly allowance runs out, and they do not expire at the end of the month.
            {(topUp.generations > 0 || topUp.chatMessages > 0) && ` You have ${topUp.generations} generations and ${topUp.chatMessages} replies left.`}
          </p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {topUpPacks.map((pack) => (
            <li key={pack.id} className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-white p-5">
              <div>
                <h3 className="font-display text-base font-bold">{pack.name}</h3>
                <p className="mt-1 text-sm text-text-secondary">
                  {pack.generations} generations and {pack.chatMessages} assistant replies
                </p>
              </div>
              <Button variant="secondary" disabled={!billingConfigured || busy !== null} onClick={() => void go(pack.id, () => billingApi.topUp(activeStore.id, pack.id))}>
                {busy === pack.id ? 'Opening...' : `Buy for ${formatPlanPrice(pack.priceCents, currency)}`}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
