import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { buttonStyles } from '../../components/ui/Button'
import { Reveal } from './Reveal'

/**
 * The closing band: the one place on the page that should interrupt. A black panel lit from below by
 * cobalt and lime, the largest heading on the page after the hero, and the lime call to action.
 */
export function FinalCta() {
  return (
    <section className="bg-bg px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
      <Reveal>
        <div className="relative mx-auto w-full max-w-5xl overflow-hidden rounded-3xl border border-border bg-surface px-6 py-16 text-center sm:px-10 lg:py-20">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div className="absolute -bottom-40 left-1/2 h-80 w-[48rem] -translate-x-1/2 rounded-full bg-landing-cobalt/40 blur-[110px]" />
            <div className="absolute -bottom-24 left-1/2 h-40 w-80 -translate-x-1/2 rounded-full bg-accent/20 blur-[80px]" />
          </div>
          <div className="relative">
            <h2 className="font-serif text-h1 font-normal tracking-tight text-text">
              Your shop could be online <em className="italic text-accent-ink">tonight</em>.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg font-medium text-text-secondary">Free to start, no card, and the AI is already included.</p>

            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link to="/register" className={buttonStyles({ variant: 'accent', size: 'lg', className: 'group w-full hover:shadow-glow-lg sm:w-auto' })}>
                Start your store free
                <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" strokeWidth={2.25} />
              </Link>
              <Link to="/shop" className={buttonStyles({ variant: 'secondary', size: 'lg', className: 'w-full sm:w-auto' })}>
                I came to shop
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  )
}
