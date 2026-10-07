import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Reveal } from './Reveal'
import { plansApi } from '../../lib/billingApi'
import type { PlanInfo } from '../../types/billing'

/**
 * Pricing, read from the same `/plans` endpoint the billing page uses, so this section cannot drift
 * from what a merchant is actually charged. Nothing here is typed in by hand.
 *
 * On currency: plans are charged in **US dollars** through Stripe, so the dollar figure is the
 * price. The rupee figure beside it is an approximate conversion at the stated rate, clearly
 * labelled as such, because quoting a rupee price we do not charge would be a lie about the product.
 * If plans are ever genuinely priced in rupees, that is a change in the backend and in Stripe, not
 * a change to this file.
 */

/**
 * The rate the rupee approximations are shown at. A fixed, stated number rather than a live rate:
 * the page tells the visitor what rate it used, so the figure can be checked instead of trusted.
 * Update it when it drifts; nothing breaks if it is stale, the label just needs to stay true.
 */
const PKR_PER_USD = 280

const approxPkr = (priceCents: number) => {
  const rupees = (priceCents / 100) * PKR_PER_USD
  return `about Rs ${Math.round(rupees / 50) * 50}`
}

/** What each plan gives, in words, built from the plan's own numbers. */
function planPoints(plan: PlanInfo): string[] {
  return [
    `${plan.maxProducts.toLocaleString()} products`,
    `${plan.aiGenerationsPerMonth} AI generations a month`,
    `${plan.aiChatMessagesPerMonth.toLocaleString()} shop assistant messages a month`,
    `${plan.maxStaff} staff accounts besides you`,
    plan.analyticsMaxDays >= 366 ? 'A full year of reports' : `${plan.analyticsMaxDays} days of reports`,
    plan.customDomain ? 'Your own domain (coming soon)' : 'Your shop on a ShopMind link',
  ]
}

function PricingCard({ plan, featured }: { plan: PlanInfo; featured: boolean }) {
  const free = plan.priceCents === 0
  return (
    <div
      className={`flex h-full flex-col gap-5 rounded-2xl border p-6 ${
        featured ? 'border-lp-green bg-lp-green text-lp-cream shadow-xl shadow-black/10' : 'border-lp-green/15 bg-white text-lp-green'
      }`}
    >
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-landing text-xl font-extrabold">{plan.name}</h3>
          {featured && <span className="rounded-full bg-lp-accent px-2.5 py-0.5 text-xs font-bold text-lp-green">Most popular</span>}
        </div>

        <p className="mt-4 flex flex-wrap items-baseline gap-x-2">
          <span className="font-landing text-4xl font-extrabold">{free ? 'Free' : `$${plan.priceCents / 100}`}</span>
          {!free && <span className={featured ? 'text-sm text-lp-cream/70' : 'text-sm text-lp-green/60'}>per month</span>}
        </p>
        {!free && (
          <p className={`mt-1 text-sm ${featured ? 'text-lp-cream/70' : 'text-lp-green/60'}`}>
            {approxPkr(plan.priceCents)} a month, at Rs {PKR_PER_USD} to the dollar
          </p>
        )}
        {free && <p className={`mt-1 text-sm ${featured ? 'text-lp-cream/70' : 'text-lp-green/60'}`}>No card needed. No time limit.</p>}
      </div>

      <ul role="list" className="flex flex-1 flex-col gap-2.5">
        {planPoints(plan).map((point) => (
          <li key={point} className="flex items-start gap-2.5 text-sm">
            <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
              <path
                d="M4 10.4l3.4 3.4L16 5.6"
                stroke={featured ? '#E8703D' : '#0B3B33'}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className={featured ? 'text-lp-cream/85' : 'text-lp-green/80'}>{point}</span>
          </li>
        ))}
      </ul>

      <Link
        to="/register"
        className={`inline-flex h-11 items-center justify-center rounded-[10px] font-landing text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
          featured
            ? 'bg-lp-cream text-lp-green outline-lp-cream hover:bg-white'
            : 'bg-lp-green text-lp-cream outline-lp-green hover:bg-lp-green-soft'
        }`}
      >
        {free ? 'Start free' : `Choose ${plan.name}`}
      </Link>
    </div>
  )
}

export function PricingSection() {
  const [plans, setPlans] = useState<PlanInfo[] | null>(null)

  useEffect(() => {
    plansApi
      .list()
      .then((list) => setPlans(list))
      .catch(() => setPlans(null))
  }, [])

  return (
    <section id="pricing" className="bg-lp-cream py-16 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <h2 className="max-w-2xl font-landing text-3xl font-extrabold leading-tight text-lp-green sm:text-4xl">
            Start free. Pay only when it is worth it.
          </h2>
          <p className="mt-4 max-w-2xl text-base text-lp-green/80">
            Every plan includes the AI, the counter sales and everything in the list above. Paid plans raise the limits. Plans are billed
            in US dollars through Stripe; the rupee figures are an approximation at the rate shown.
          </p>
        </Reveal>

        {plans === null ? (
          <p className="mt-10 text-sm text-lp-green/70">
            Plan prices are loading. If they do not appear,{' '}
            <Link to="/register" className="font-semibold underline">
              start free
            </Link>{' '}
            and see them in your dashboard.
          </p>
        ) : (
          <ul role="list" className="mt-10 grid gap-5 lg:grid-cols-3">
            {plans.map((plan, i) => (
              <li key={plan.tier}>
                <Reveal delayMs={i * 90} className="h-full">
                  <PricingCard plan={plan} featured={plan.tier === 'PRO'} />
                </Reveal>
              </li>
            ))}
          </ul>
        )}

        <Reveal delayMs={140}>
          <p className="mt-6 text-sm text-lp-green/70">
            Run out of AI for the month? Carry on without it, wait for the reset, or buy a one-off pack. Nothing stops working and nothing
            is charged automatically.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
