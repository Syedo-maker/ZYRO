import { Link } from 'react-router-dom'

/**
 * The footer, including the note that this is a university project.
 *
 * That note is there on purpose: somebody deciding whether to put their livelihood on a platform is
 * entitled to know it is a final year project rather than an established company. Burying that
 * would be the dishonest choice.
 *
 * The social icons link nowhere yet, so they are not rendered at all. An icon that does nothing is
 * worse than an absent one, and inventing accounts we do not have would be the same kind of fiction
 * as a fake testimonial.
 */
const COLUMNS: { heading: string; links: { label: string; to: string; external?: boolean }[] }[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Features', to: '#features' },
      { label: 'How it works', to: '#how-it-works' },
      { label: 'Pricing', to: '#pricing' },
      { label: 'Questions', to: '#faq' },
    ],
  },
  {
    heading: 'Get started',
    links: [
      { label: 'Start your store free', to: '/register' },
      { label: 'Browse stores', to: '/shop' },
      { label: 'Log in', to: '/login' },
    ],
  },
]

export function LandingFooter() {
  return (
    <footer className="bg-lp-green pb-10 pt-14">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <p className="font-landing text-lg font-extrabold text-lp-cream">
              ShopMind<span className="text-lp-accent"> AI</span>
            </p>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-lp-cream/70">
              A free place for small businesses in Pakistan to sell online, with the AI built in rather than sold separately.
            </p>
            <p className="mt-4 text-sm text-lp-cream/70">
              <a href="mailto:finalyear860@gmail.com" className="underline decoration-lp-cream/30 underline-offset-4 hover:text-lp-cream">
                finalyear860@gmail.com
              </a>
            </p>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="font-landing text-sm font-bold uppercase tracking-wide text-lp-cream/50">{column.heading}</h2>
              <ul role="list" className="mt-4 flex flex-col gap-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.to.startsWith('#') ? (
                      <a href={link.to} className="text-sm text-lp-cream/80 hover:text-lp-cream">
                        {link.label}
                      </a>
                    ) : (
                      <Link to={link.to} className="text-sm text-lp-cream/80 hover:text-lp-cream">
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-lp-cream/15 pt-6 text-sm text-lp-cream/55 sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} ShopMind AI</p>
          <p className="max-w-xl sm:text-right">
            A final year project by Muhammad Ibrahim and Syed Sikander Gillani, supervised by Mr. Saad Ilyas. Built as coursework, not as a
            registered company.
          </p>
        </div>
      </div>
    </footer>
  )
}
