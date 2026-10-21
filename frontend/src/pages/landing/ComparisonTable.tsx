import { Reveal } from './Reveal'

/**
 * How we differ, without naming anyone.
 *
 * The right-hand column says "a typical hosted store platform", because that is a fair description
 * of the category and not a claim about any particular company's current pricing, which we have not
 * audited and which changes. Every left-hand cell is something this product does today.
 *
 * On a phone a seven-row table would shrink past readability, so the same content is rendered as a
 * list of cards there and as a real `<table>` from the medium breakpoint up.
 */
const ROWS: { feature: string; ours: string; typical: string }[] = [
  { feature: 'Monthly fee to open a shop', ours: 'Nothing. The free plan has no card and no time limit.', typical: 'Usually a monthly subscription from the start, sometimes after a short trial.' },
  { feature: 'AI writing help', ours: 'Included on every plan, the free one too.', typical: 'Commonly a paid add-on, or limited to higher tiers.' },
  { feature: 'Trending keyword suggestions', ours: 'Built in: titles and descriptions from what shoppers really search for, with the keywords shown.', typical: 'Not usually offered. Keyword research is normally a separate tool you buy.' },
  { feature: 'Setup', ours: 'Sign up, add a product, share the link. No apps to install.', typical: 'Often a theme to choose and apps to add before the shop does what you need.' },
  { feature: 'Counter sales from the same stock', ours: 'Included, with shifts, held sales and returns.', typical: 'Frequently a separate product with its own fee and its own hardware.' },
  { feature: 'Made for Pakistan', ours: 'Prices in rupees, cash on delivery, bank transfer with receipt checking, Roman Urdu understood.', typical: 'Built for other markets first; local payment habits often need a third-party app.' },
]

export function ComparisonTable() {
  return (
    <section className="bg-subtle py-16 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <h2 className="max-w-2xl font-display text-3xl font-extrabold leading-tight text-text sm:text-4xl">
            Why ZYRO
          </h2>
          <p className="mt-4 max-w-2xl text-base text-text-secondary">
            We have not named anyone, because platforms change their prices and we would rather be accurate than clever.
          </p>
        </Reveal>

        <Reveal delayMs={100}>
          {/* Phone: cards. A six-row, three-column table is unreadable at 375px. */}
          <ul role="list" className="mt-9 flex flex-col gap-4 md:hidden">
            {ROWS.map((row) => (
              <li key={row.feature} className="rounded-2xl border border-border bg-bg p-5">
                <h3 className="font-display text-base font-bold text-text">{row.feature}</h3>
                <p className="mt-3 text-xs font-bold uppercase tracking-wide text-accent">ZYRO</p>
                <p className="mt-1 text-sm text-text-secondary">{row.ours}</p>
                <p className="mt-3 text-xs font-bold uppercase tracking-wide text-text-muted">A typical platform</p>
                <p className="mt-1 text-sm text-text-muted">{row.typical}</p>
              </li>
            ))}
          </ul>

          <div className="mt-9 hidden overflow-hidden rounded-2xl border border-border bg-bg md:block">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">ZYRO compared with a typical hosted store platform</caption>
              <thead>
                <tr className="bg-inverse text-on-inverse">
                  <th scope="col" className="px-5 py-4 font-display text-sm font-bold">
                    Feature
                  </th>
                  <th scope="col" className="px-5 py-4 font-display text-sm font-bold">
                    ZYRO
                  </th>
                  <th scope="col" className="px-5 py-4 font-display text-sm font-bold text-on-inverse-muted">
                    A typical hosted store platform
                  </th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row, i) => (
                  <tr key={row.feature} className={i % 2 === 1 ? 'bg-subtle/35' : ''}>
                    <th scope="row" className="w-[22%] px-5 py-4 align-top font-display text-sm font-bold text-text">
                      {row.feature}
                    </th>
                    <td className="w-[39%] px-5 py-4 align-top text-sm text-text-secondary">{row.ours}</td>
                    <td className="px-5 py-4 align-top text-sm text-text-muted">{row.typical}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
