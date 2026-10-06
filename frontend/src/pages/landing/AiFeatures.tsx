import type { ReactNode } from 'react'
import { Reveal } from './Reveal'
import { AssistantMockup, CartRecoveryMockup, InsightsMockup, RecommendationsMockup, TrendingMockup } from './Mockups'

interface FeatureProps {
  id?: string
  kicker: string
  title: string
  body: string
  points: string[]
  mockup: ReactNode
  /** The first feature is the one we are actually different for, so it gets the room. */
  lead?: boolean
  /** Alternates the section background, so the page has a rhythm rather than one long wall. */
  tone: 'cream' | 'sage'
  /** Puts the mock-up on the left on wide screens, so consecutive sections do not mirror each other. */
  flip?: boolean
}

/**
 * One AI feature, told as: what it is, why it matters, what it actually does. Every feature here is
 * built and working in the product today; nothing on this page is a plan.
 */
function AiFeatureSection({ id, kicker, title, body, points, mockup, lead = false, tone, flip = false }: FeatureProps) {
  return (
    <section id={id} className={tone === 'cream' ? 'bg-lp-cream py-12 lg:py-16' : 'bg-lp-sage py-14 lg:py-20'}>
      <div
        className={`mx-auto grid w-full max-w-6xl items-center gap-8 px-4 sm:px-6 lg:gap-14 lg:px-8 ${
          lead ? 'lg:grid-cols-[1fr_1fr]' : 'lg:grid-cols-[1.15fr_0.85fr]'
        }`}
      >
        <Reveal className={flip ? 'lg:order-2' : ''}>
          <p className="font-landing text-xs font-bold uppercase tracking-[0.14em] text-lp-accent-strong">{kicker}</p>
          <h3 className={`mt-3 font-landing font-extrabold leading-tight text-lp-green ${lead ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl'}`}>
            {title}
          </h3>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-lp-green/80">{body}</p>
          <ul role="list" className="mt-5 flex flex-col gap-2.5">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-sm text-lp-green/85">
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
                  <circle cx="10" cy="10" r="9" fill="#0B3B33" />
                  <path d="M6 10.4l2.6 2.6L14 7.6" stroke="#F4F3EE" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delayMs={120} className={flip ? 'lg:order-1' : ''}>
          {mockup}
        </Reveal>
      </div>
    </section>
  )
}

export function AiFeatures() {
  return (
    <div id="features">
      {/* The block needs its own heading, both so the five features below can be h3 under something
          rather than skipping a level, and because jumping straight from the problem into feature
          one left the reader with no idea what they were about to read. */}
      <section className="bg-lp-cream pt-16 lg:pt-24">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
          <Reveal>
            <h2 className="max-w-3xl font-landing text-3xl font-extrabold leading-tight text-lp-green sm:text-4xl">
              The AI is the product, not an add-on.
            </h2>
            <p className="mt-4 max-w-2xl text-base text-lp-green/80">
              Five things it does for you and your shoppers, included on every plan. All of it is built and running today.
            </p>
          </Reveal>
        </div>
      </section>

      <AiFeatureSection
        lead
        tone="cream"
        kicker="The one you will not find elsewhere"
        title="Trending suggestions, while you add the product"
        body="Name a product and the AI offers titles and descriptions built around the words shoppers are really using. Each suggestion shows which of those words it contains, so you can see where the wording came from instead of taking it on trust."
        points={[
          'Keywords come from real data: what sells across ShopMind shops, imported Google Trends, and what shoppers search for here.',
          'A word is only used once several different shops have seen it, so no shop can read another shop’s data.',
          'If a category has no trend data yet, it says so plainly rather than making something up.',
          'Nothing is saved until you pick a suggestion and save the product. Edit any of it first.',
        ]}
        mockup={<TrendingMockup />}
      />

      <AiFeatureSection
        tone="sage"
        flip
        kicker="For your shoppers"
        title="A shop assistant that only talks about your products"
        body="Shoppers ask in their own words and get answers from your catalogue, with your prices and your stock. It cannot invent a product you do not sell."
        points={['Answers from your catalogue only.', 'Handles Roman Urdu and English.', 'Hands over to your order tracking when asked about a delivery.']}
        mockup={<AssistantMockup />}
      />

      <AiFeatureSection
        tone="cream"
        kicker="For your shoppers"
        title="Products like this one, matched on meaning"
        body="Shoppers looking at one product see others that genuinely resemble it, matched on what the product is rather than on words that happen to overlap in the title."
        points={['Works from the product’s own description.', 'Only ever suggests products from the same shop.', 'Quietly disappears if there is nothing close enough.']}
        mockup={<RecommendationsMockup />}
      />

      <AiFeatureSection
        tone="sage"
        flip
        kicker="For you"
        title="A nudge for the baskets people walked away from"
        body="When somebody fills a basket and leaves, the AI drafts a short reminder. You read it and decide whether it goes."
        points={['You approve every message.', 'Never sent twice for the same basket.', 'Stops as soon as they buy.']}
        mockup={<CartRecoveryMockup />}
      />

      <AiFeatureSection
        tone="cream"
        kicker="For you"
        title="One useful thing to do this week"
        body="Each week the AI reads your own figures and writes one practical suggestion: what is selling, what is running low, what is worth trying. Written from your numbers, never another shop’s."
        points={['Built from your own sales, stock and orders.', 'Costs nothing from your AI allowance: we pay for it.', 'Switch it off whenever you like.']}
        mockup={<InsightsMockup />}
      />
    </div>
  )
}
