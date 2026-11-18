import { ShieldCheck, CreditCard, LockKeyhole, Scale } from 'lucide-react'
import { Reveal } from './Reveal'

/**
 * Trust, in plain language, and only things that are actually true of the running system.
 *
 * Each claim here maps to something real: tenant scoping enforced in the data layer rather than
 * remembered by each query, Stripe Checkout so card numbers never touch our servers, bcrypt-hashed
 * passwords, and the AI never being given authority over money or stock.
 */
const POINTS = [
  {
    title: 'Your shop is sealed off from every other shop',
    body: 'Isolation is enforced in the layer that talks to the database, not left to each query to remember. A query that forgets which shop it is about is refused rather than quietly answered with the wrong data.',
    icon: ShieldCheck,
  },
  {
    title: 'We never see your customers’ card numbers',
    body: 'Card payments go through Stripe’s own checkout page. The card details are typed on Stripe, not on us, and a plan only ever changes after Stripe confirms the money moved.',
    icon: CreditCard,
  },
  {
    title: 'Passwords are hashed, never stored',
    body: 'Nobody here can read your password, because it is not kept. Sessions use short-lived tokens, and signing out really ends the session.',
    icon: LockKeyhole,
  },
  {
    title: 'The AI never touches money or stock by itself',
    body: 'It drafts and suggests; you decide. Every price, discount and plan is worked out on the server, so nothing a shopper or the AI types can change what something costs.',
    icon: Scale,
  },
]

export function TrustSection() {
  return (
    <section className="bg-bg py-16 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <h2 className="max-w-2xl font-serif text-h1 font-normal tracking-tight text-text">
            Built so your shop, and your customers, stay <em className="italic text-accent-ink">safe</em>.
          </h2>
        </Reveal>

        <ul role="list" className="mt-10 grid gap-5 md:grid-cols-2">
          {POINTS.map((point, i) => (
            <li key={point.title}>
              <Reveal delayMs={(i % 2) * 90}>
                <div className="flex h-full gap-4 rounded-2xl border border-border bg-surface p-6">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-landing-cobalt/25 text-text">
                    <point.icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <div>
                    <h3 className="font-display text-base font-bold text-text">{point.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-text-muted">{point.body}</p>
                  </div>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
