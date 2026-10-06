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
    path: 'M12 3l8 3v6c0 4.5-3.2 7.9-8 9-4.8-1.1-8-4.5-8-9V6z',
  },
  {
    title: 'We never see your customers’ card numbers',
    body: 'Card payments go through Stripe’s own checkout page. The card details are typed on Stripe, not on us, and a plan only ever changes after Stripe confirms the money moved.',
    path: 'M3 7h18v10H3zM3 11h18M7 15h3',
  },
  {
    title: 'Passwords are hashed, never stored',
    body: 'Nobody here can read your password, because it is not kept. Sessions use short-lived tokens, and signing out really ends the session.',
    path: 'M7 11V8a5 5 0 0110 0v3M5 11h14v9H5zM12 15v2',
  },
  {
    title: 'The AI never touches money or stock by itself',
    body: 'It drafts and suggests; you decide. Every price, discount and plan is worked out on the server, so nothing a shopper or the AI types can change what something costs.',
    path: 'M12 4v16M8 8h8M6 12h12M8 16h8',
  },
]

export function TrustSection() {
  return (
    <section className="bg-lp-green py-16 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <h2 className="max-w-2xl font-landing text-3xl font-extrabold leading-tight text-lp-cream sm:text-4xl">
            Built so your shop, and your customers, stay safe.
          </h2>
        </Reveal>

        <ul role="list" className="mt-10 grid gap-5 md:grid-cols-2">
          {POINTS.map((point, i) => (
            <li key={point.title}>
              <Reveal delayMs={(i % 2) * 90}>
                <div className="flex h-full gap-4 rounded-2xl border border-lp-cream/15 bg-lp-cream/[0.06] p-6">
                  <svg
                    width="26"
                    height="26"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#E8703D"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="mt-0.5 shrink-0"
                  >
                    <path d={point.path} />
                  </svg>
                  <div>
                    <h3 className="font-landing text-base font-bold text-lp-cream">{point.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-lp-cream/70">{point.body}</p>
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
