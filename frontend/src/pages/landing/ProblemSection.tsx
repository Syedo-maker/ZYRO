import { Reveal } from './Reveal'

const PAINS = [
  {
    title: 'The monthly fee starts before the first sale',
    body: 'Most platforms want a subscription whether you sold anything that month or not. For somebody testing an idea from home, that is the wrong way round.',
  },
  {
    title: 'The AI is sold back to you as an extra',
    body: 'Writing help, recommendations, insights: each one another add-on with another price. You end up paying separately for the parts that were supposed to help you grow.',
  },
  {
    title: 'Nobody tells you what shoppers are typing',
    body: 'You name a product the way you think of it. Shoppers search for it in their own words. If those do not match, your product may as well not be listed.',
  },
]

/** Three honest problems, stated plainly, before anything is claimed about solving them. */
export function ProblemSection() {
  return (
    <section className="bg-lp-cream py-16 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <h2 className="max-w-2xl font-landing text-3xl font-extrabold leading-tight text-lp-green sm:text-4xl">
            Selling online should not be this expensive, or this confusing.
          </h2>
        </Reveal>

        <ul role="list" className="mt-10 grid gap-5 md:grid-cols-3">
          {PAINS.map((pain, i) => (
            <li key={pain.title}>
              <Reveal delayMs={i * 90}>
                <div className="flex h-full flex-col gap-3 rounded-2xl border border-lp-green/10 bg-white p-6">
                  <span aria-hidden="true" className="font-landing text-3xl font-extrabold text-lp-accent">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className="font-landing text-lg font-bold text-lp-green">{pain.title}</h3>
                  <p className="text-sm leading-relaxed text-lp-green/75">{pain.body}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
