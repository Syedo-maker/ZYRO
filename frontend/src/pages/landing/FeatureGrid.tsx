import { Package, ShoppingCart, Truck, TicketPercent, Star, ChartColumn, Users, Monitor, type LucideIcon } from 'lucide-react'
import { Reveal } from './Reveal'

/**
 * Everything that is not AI. A shop needs all of this to actually trade, and all of it is built, so
 * it is listed plainly rather than dressed up: the AI is the reason to choose us, but this is the
 * reason the shop works.
 *
 * Icons come from the one icon set the whole platform uses (lucide), at the same stroke width.
 */
const ITEMS: { title: string; body: string; icon: LucideIcon }[] = [
  { title: 'Product catalogue', body: 'Photos, sale and MRP prices, stock, SKUs, tags and your own categories.', icon: Package },
  { title: 'Cart and checkout', body: 'Guest checkout, so a shopper can buy without making an account.', icon: ShoppingCart },
  { title: 'Orders and shipping', body: 'Shipping zones and rates, order status, refunds and returns.', icon: Truck },
  { title: 'Discount codes', body: 'Percentage or fixed, with limits on how often a code can be used.', icon: TicketPercent },
  { title: 'Reviews', body: 'Shoppers rate what they bought, and you moderate what appears.', icon: Star },
  { title: 'Analytics', body: 'Sales, best sellers, revenue by category, online against the counter.', icon: ChartColumn },
  { title: 'Staff accounts', body: 'Give your team only what they need: selling, orders, discounts or reports.', icon: Users },
  { title: 'Counter sales (POS)', body: 'Sell face to face from the same stock, with shifts, held sales and returns.', icon: Monitor },
]

export function FeatureGrid() {
  return (
    <section className="bg-bg py-16 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <h2 className="max-w-2xl font-serif text-h1 font-normal tracking-tight text-text">
            And everything else a shop <em className="italic text-accent-ink">actually needs</em>.
          </h2>
          <p className="mt-4 max-w-2xl text-base text-text-secondary">
            All of it included on every plan, the free one too. One catalogue and one set of stock, whether you sell online or across a
            counter.
          </p>
        </Reveal>

        <ul role="list" className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map((item, i) => (
            <li key={item.title}>
              <Reveal delayMs={(i % 4) * 70}>
                <div className="group flex h-full flex-col gap-3 rounded-2xl border border-border bg-surface p-5 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-accent-ink/40">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/10 text-accent-ink">
                    <item.icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <h3 className="font-display text-base font-bold text-text">{item.title}</h3>
                  <p className="text-sm leading-relaxed text-text-muted">{item.body}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
