import { Reveal } from './Reveal'

/**
 * Everything that is not AI. A shop needs all of this to actually trade, and all of it is built, so
 * it is listed plainly rather than dressed up: the AI is the reason to choose us, but this is the
 * reason the shop works.
 *
 * Icons are inline paths on a shared 24-unit grid, so there is no icon library to download and no
 * emoji standing in for a drawing.
 */
const ITEMS: { title: string; body: string; path: string }[] = [
  { title: 'Product catalogue', body: 'Photos, prices, stock, SKUs, barcodes, tags and categories.', path: 'M4 7h16v13H4zM4 7l2-3h12l2 3M9 12h6' },
  { title: 'Cart and checkout', body: 'Guest checkout, so a shopper can buy without making an account.', path: 'M3 5h2l2.5 11h11L21 8H6M9 20a1 1 0 100-2 1 1 0 000 2M18 20a1 1 0 100-2 1 1 0 000 2' },
  { title: 'Orders and shipping', body: 'Shipping zones and rates, order status, refunds and returns.', path: 'M3 8h12v8H3zM15 11h4l2 3v2h-6M6 19a1 1 0 100-2 1 1 0 000 2M18 19a1 1 0 100-2 1 1 0 000 2' },
  { title: 'Discount codes', body: 'Percentage or fixed, with limits on how often a code can be used.', path: 'M4 9l5-5 11 11-5 5zM8.5 8.5h.01M13 14l3 3' },
  { title: 'Reviews', body: 'Shoppers rate what they bought, and you moderate what appears.', path: 'M12 4l2.5 5 5.5.8-4 3.9.9 5.5L12 16.6 7.1 19.2 8 13.7 4 9.8l5.5-.8z' },
  { title: 'Analytics', body: 'Sales, best sellers, revenue by category, online against the counter.', path: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { title: 'Staff accounts', body: 'Give your team only what they need: selling, orders, discounts or reports.', path: 'M8 11a3 3 0 100-6 3 3 0 000 6M2 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 7a3 3 0 110 6M18 20c0-2.2-.9-4.2-2.3-5.6' },
  { title: 'Counter sales (POS)', body: 'Sell face to face from the same stock, with shifts, held sales and returns.', path: 'M4 4h16v6H4zM6 14h12M6 18h8M4 10v10h16V10' },
]

export function FeatureGrid() {
  return (
    <section className="bg-lp-green py-16 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <h2 className="max-w-2xl font-landing text-3xl font-extrabold leading-tight text-lp-cream sm:text-4xl">
            And everything else a shop actually needs.
          </h2>
          <p className="mt-4 max-w-2xl text-base text-lp-cream/80">
            All of it included on every plan, the free one too. One catalogue and one set of stock, whether you sell online or across a
            counter.
          </p>
        </Reveal>

        <ul role="list" className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map((item, i) => (
            <li key={item.title}>
              <Reveal delayMs={(i % 4) * 70}>
                <div className="flex h-full flex-col gap-2.5 rounded-2xl border border-lp-cream/15 bg-lp-cream/[0.06] p-5 transition-colors hover:border-lp-cream/35">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#E8703D" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={item.path} />
                  </svg>
                  <h3 className="font-landing text-base font-bold text-lp-cream">{item.title}</h3>
                  <p className="text-sm leading-relaxed text-lp-cream/70">{item.body}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
