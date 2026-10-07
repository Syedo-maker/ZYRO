import { Link } from 'react-router-dom'
import { Reveal } from './Reveal'

/**
 * The closing band. Orange, because this is the one place on the page that should interrupt.
 *
 * The heading is deliberately large: the brand orange only reaches a 4.04 contrast ratio against
 * the dark green, which is fine for large text and UI shapes but not for small text, so nothing
 * small sits on this background and the button is solid green with cream on it (11.2).
 */
export function FinalCta() {
  return (
    <section className="bg-lp-accent py-16 lg:py-20">
      <div className="mx-auto w-full max-w-4xl px-4 text-center sm:px-6 lg:px-8">
        <Reveal>
          <h2 className="font-landing text-3xl font-extrabold leading-tight text-lp-green sm:text-[2.6rem]">
            Your shop could be online tonight.
          </h2>
          <p className="mx-auto mt-4 max-w-xl font-landing text-lg font-semibold text-lp-green">
            Free to start, no card, and the AI is already included.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/register"
              className="inline-flex h-12 w-full items-center justify-center rounded-[10px] bg-lp-green px-7 font-landing text-base font-bold text-lp-cream transition-transform hover:bg-lp-green-soft motion-safe:hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lp-green sm:w-auto"
            >
              Start your store free
            </Link>
            <Link
              to="/shop"
              className="inline-flex h-12 w-full items-center justify-center rounded-[10px] border-2 border-lp-green px-7 font-landing text-base font-bold text-lp-green transition-colors hover:bg-lp-green hover:text-lp-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lp-green sm:w-auto"
            >
              I came to shop
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
