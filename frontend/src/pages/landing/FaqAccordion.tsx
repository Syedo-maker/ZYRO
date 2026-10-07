import { Reveal } from './Reveal'

/**
 * The questions a merchant actually asks before signing up, answered accurately rather than
 * promotionally. Where the honest answer is a limitation, it says so.
 *
 * Built on `<details>` and `<summary>`: keyboard operation, screen-reader semantics and open/close
 * state all come from the browser, which is more robust than re-implementing a disclosure with
 * div elements and ARIA.
 */
const QUESTIONS: { q: string; a: string }[] = [
  {
    q: 'Is it really free?',
    a: 'Yes. The free plan has no card, no trial period and no expiry. It allows 50 products, two staff accounts, 30 days of reports and a monthly allowance of AI generations. You only pay if you outgrow those limits.',
  },
  {
    q: 'How do the trending suggestions actually work?',
    a: 'When you name a product, we look up the popular search words for that category from three real sources: words from products selling well across ShopMind shops, Google Trends data a platform administrator has imported, and what shoppers type into ShopMind search boxes. The AI is given that list and asked to write titles and descriptions around the fitting ones. Each suggestion then shows which of those words it genuinely contains, checked on our server rather than taken from the AI.',
  },
  {
    q: 'Can one shop see another shop’s data through this?',
    a: 'No. A search word is only ever used once at least five different shops have seen it, and the suggestions are built from that pooled list, never from one shop’s own figures. Your products, sales and customers are never shown to anyone else, and no shop is ever named.',
  },
  {
    q: 'What is the AI quota, and what happens when it runs out?',
    a: 'Each plan includes a number of AI generations and shop assistant messages per month. Asking for a set of suggestions costs one generation, however many suggestions you read. When the allowance runs out the shop carries on working normally, you simply write listings yourself until the month resets, or buy a one-off top-up pack. Nothing is charged automatically and nothing stops selling.',
  },
  {
    q: 'Do you support cash on delivery?',
    a: 'Yes. You can take cash on delivery and bank transfers alongside card payments. For a transfer, the shopper sends a photo of the receipt and the AI reads it to help you check it, but you confirm every payment yourself. Cash-on-delivery orders get a risk assessment you can act on or ignore.',
  },
  {
    q: 'Can I use my own domain name?',
    a: 'Not yet, honestly. The Business plan reserves a custom domain and you can save one, but serving your shop on it is still being built. Until then every shop runs on its own ShopMind link, which works perfectly well for sharing.',
  },
  {
    q: 'Does it work on a phone?',
    a: 'Yes, both sides. You can run your shop from a phone, and your customers can buy from one. The counter-sales screen is built for a phone or tablet too, so you do not need a till.',
  },
  {
    q: 'Is my data safe?',
    a: 'Each shop is isolated at the database layer rather than by convention, card details are handled by Stripe and never reach us, and passwords are hashed so nobody here can read them. We store what the shop needs to run and nothing else.',
  },
]

export function FaqAccordion() {
  return (
    <section id="faq" className="bg-lp-cream py-16 lg:py-24">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <h2 className="font-landing text-3xl font-extrabold leading-tight text-lp-green sm:text-4xl">Questions, answered straight</h2>
        </Reveal>

        <div className="mt-9 flex flex-col gap-3">
          {QUESTIONS.map((item, i) => (
            <Reveal key={item.q} delayMs={Math.min(i, 4) * 60}>
              <details className="group rounded-2xl border border-lp-green/12 bg-white px-5 py-4 open:border-lp-green/30">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-landing text-base font-bold text-lp-green focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lp-green">
                  {item.q}
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    aria-hidden="true"
                    className="shrink-0 transition-transform group-open:rotate-45 motion-reduce:transition-none"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-lp-green/80">{item.a}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
