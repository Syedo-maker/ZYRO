import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { buttonStyles } from '../../components/ui/Button'
import { TrendingDemo } from './TrendingDemo'

/**
 * The hero. The headline leads with the thing nothing else here does: telling a shop owner what
 * people are actually searching for, at the moment they are naming a product.
 *
 * The demo sits beside it rather than a screenshot of the demo, because the real thing is more
 * convincing than a picture of it, and because this page should not claim anything it cannot do
 * in front of the visitor.
 *
 * The landing page is the one place all three brand colours meet: Midnight Black for the page,
 * Electric Cobalt for the glows and the grid behind the demo, Acid Lime for the call to action and
 * the one highlighted phrase.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden bg-bg">
      {/* Cobalt glows and a faint grid, drawn rather than photographed, so the black has depth. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -right-40 -top-40 h-[42rem] w-[42rem] rounded-full bg-landing-cobalt/35 blur-[140px]" />
        <div className="absolute -bottom-48 -left-32 h-[30rem] w-[30rem] rounded-full bg-landing-cobalt-light/20 blur-[120px]" />
        <div className="absolute right-[18%] top-[30%] h-56 w-56 rounded-full bg-accent/10 blur-[90px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_srgb,var(--color-text)_5%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_srgb,var(--color-text)_5%,transparent)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_at_70%_40%,black,transparent_70%)]" />
      </div>

      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pb-20 pt-12 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:px-8 lg:pb-28 lg:pt-20">
        <div className="flex flex-col items-start gap-6 motion-safe:animate-fade-up">
          <p className="inline-flex items-center gap-2 rounded-full border border-accent-ink/30 bg-accent/10 px-3 py-1 font-display text-xs font-bold uppercase tracking-[0.16em] text-accent-ink">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
            Apni dukaan online lao
          </p>

          <h1 className="font-serif text-display font-normal tracking-tight text-text">
            Add a product. See what Pakistan is <em className="italic text-accent-ink">actually searching for</em>.
          </h1>

          <p className="max-w-xl text-base text-text-secondary sm:text-lg">
            A free online shop for small businesses, with the AI built in. It writes your titles and descriptions using the words real
            shoppers type, so your products get found.
          </p>

          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <Link to="/register" className={buttonStyles({ variant: 'accent', size: 'lg', className: 'group hover:shadow-glow-lg' })}>
              Start your store free
              <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" strokeWidth={2.25} />
            </Link>
            <Link to="/shop" className={buttonStyles({ variant: 'secondary', size: 'lg' })}>
              Shop now
            </Link>
          </div>

          <p className="text-sm text-text-muted">No card needed. Free plan, forever.</p>
        </div>

        <div className="relative">
          <div aria-hidden="true" className="pointer-events-none absolute -inset-6 rounded-[2rem] bg-gradient-to-br from-landing-cobalt/40 via-transparent to-accent/10 blur-2xl" />
          <div className="relative">
            <TrendingDemo />
          </div>
        </div>
      </div>
    </section>
  )
}
