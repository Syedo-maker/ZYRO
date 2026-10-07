import { Link } from 'react-router-dom'
import { TrendingDemo } from './TrendingDemo'

/**
 * The hero. The headline leads with the thing nothing else here does: telling a shop owner what
 * people are actually searching for, at the moment they are naming a product.
 *
 * The demo sits beside it rather than a screenshot of the demo, because the real thing is more
 * convincing than a picture of it, and because this page should not claim anything it cannot do
 * in front of the visitor.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden bg-lp-green">
      {/* Two soft shapes, drawn rather than photographed, to stop the dark band reading as flat. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-lp-accent/20 blur-3xl" />
        <div className="absolute -bottom-32 left-1/4 h-64 w-64 rounded-full bg-lp-sage/10 blur-3xl" />
      </div>

      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 lg:px-8 lg:pb-24 lg:pt-16">
        <div className="flex flex-col items-start gap-5">
          <p className="font-landing text-sm font-bold uppercase tracking-[0.14em] text-lp-accent">Apni dukaan online lao</p>

          <h1 className="font-landing text-[2.1rem] font-extrabold leading-[1.1] text-lp-cream sm:text-5xl lg:text-[3.4rem]">
            Add a product. See what Pakistan is actually searching for.
          </h1>

          <p className="max-w-xl text-base text-lp-cream/85 sm:text-lg">
            A free online shop for small businesses, with the AI built in. It writes your titles and descriptions using the words real
            shoppers type, so your products get found.
          </p>

          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <Link
              to="/register"
              className="inline-flex h-12 items-center justify-center rounded-[10px] bg-lp-accent-strong px-6 font-landing text-base font-bold text-white transition-transform hover:bg-lp-accent hover:text-lp-green motion-safe:hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lp-cream"
            >
              Start your store free
            </Link>
            <Link
              to="/shop"
              className="inline-flex h-12 items-center justify-center rounded-[10px] border border-lp-cream/40 px-6 font-landing text-base font-bold text-lp-cream transition-colors hover:bg-lp-cream hover:text-lp-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lp-cream"
            >
              Shop now
            </Link>
          </div>

          <p className="text-sm text-lp-cream/70">No card needed. Free plan, forever.</p>
        </div>

        <TrendingDemo />
      </div>
    </section>
  )
}
