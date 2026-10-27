import { Link } from 'react-router-dom'
import { buttonStyles } from '../../components/ui/Button'
import { Reveal } from './Reveal'

const STEPS = [
  {
    title: 'Sign up and name your shop',
    body: 'An email and a password. Choose your shop name and the currency you sell in. No card, and nothing to install.',
    visual: (
      <div className="flex flex-col gap-2">
        <div className="h-2.5 w-24 rounded bg-inverse/15" />
        <div className="h-9 rounded-lg border border-border bg-surface" />
        <div className="h-2.5 w-16 rounded bg-inverse/15" />
        <div className="h-9 rounded-lg border border-border bg-surface" />
        <div className="mt-1 h-9 w-32 rounded-lg bg-inverse" />
      </div>
    ),
  },
  {
    title: 'Add a product, and let the AI write it',
    body: 'Type what you sell. Pick one of the suggestions, change anything you like, and save. The keywords it used are shown underneath.',
    visual: (
      <div className="flex flex-col gap-2">
        <div className="flex gap-1">
          {['lawn suit', '3 piece'].map((w) => (
            <span key={w} className="rounded-full bg-subtle px-2 py-0.5 text-[10px] font-medium text-text">
              {w}
            </span>
          ))}
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="rounded-lg bg-surface p-2">
            <div className="h-2 w-3/4 rounded bg-inverse/25" />
            <div className="mt-1.5 h-1.5 w-full rounded bg-inverse/10" />
            <div className="mt-1 h-1.5 w-5/6 rounded bg-inverse/10" />
          </div>
        ))}
        <div className="h-8 w-24 rounded-lg bg-accent" />
      </div>
    ),
  },
  {
    title: 'Share your link and start selling',
    body: 'Your shop is live on its own link. Take card payments, cash on delivery or a bank transfer, and sell at the counter from the same stock.',
    visual: (
      <div className="flex flex-col gap-2">
        <div className="rounded-lg bg-surface p-2.5">
          <div className="h-2 w-20 rounded bg-inverse/25" />
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 rounded bg-subtle" />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-inverse px-2.5 py-2">
          <div className="h-2 w-16 rounded bg-on-inverse/50" />
          <div className="h-2 w-8 rounded bg-accent-display" />
        </div>
      </div>
    ),
  },
]

/** Three steps, because that is genuinely how long it takes to get a shop live. */
export function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-bg py-16 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <h2 className="max-w-2xl font-display text-3xl font-extrabold leading-tight text-text sm:text-4xl">
            Live in three steps.
          </h2>
        </Reveal>

        <ol role="list" className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <Reveal delayMs={i * 110}>
                <div className="flex h-full flex-col gap-4 rounded-2xl border border-border bg-subtle/50 p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-inverse font-display text-sm font-extrabold text-on-inverse">
                      {i + 1}
                    </span>
                    <h3 className="font-display text-lg font-bold text-text">{step.title}</h3>
                  </div>
                  <p className="text-sm leading-relaxed text-text-secondary">{step.body}</p>
                  <div aria-hidden="true" className="mt-auto rounded-xl bg-bg p-3">
                    {step.visual}
                  </div>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>

        <Reveal delayMs={160}>
          <div className="mt-10">
            <Link
              to="/register"
              className={buttonStyles({ variant: 'primary', size: 'lg', className: 'font-display font-bold' })}
            >
              Start your store free
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
