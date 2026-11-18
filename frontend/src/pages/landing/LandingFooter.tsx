import { Link } from 'react-router-dom'
import { CONTACT_LINES } from '../../lib/legal'
import { ThemeToggle } from '../../components/ui/ThemeToggle'

/**
 * The footer. Zyro is in early access and says so; contact details are "coming soon" as plain text,
 * with no links, until they exist.
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
  {
    heading: 'Legal',
    links: [
      { label: 'Terms of Service', to: '/terms' },
      { label: 'Privacy Policy', to: '/privacy' },
      { label: 'Contact', to: '/contact' },
    ],
  },
]

export function LandingFooter() {
  return (
    <footer className="bg-inverse pb-10 pt-14">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <p className="font-display text-lg font-extrabold text-on-inverse">
              ZYRO
            </p>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-on-inverse-muted">
              A free place for small businesses in Pakistan to sell online, with the AI built in rather than sold separately.
            </p>
            <ul role="list" className="mt-4 flex flex-col gap-1 text-sm text-on-inverse-muted">
              {CONTACT_LINES.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="font-display text-sm font-bold uppercase tracking-wide text-on-inverse-muted">{column.heading}</h2>
              <ul role="list" className="mt-4 flex flex-col gap-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.to.startsWith('#') ? (
                      <a href={link.to} className="text-sm text-on-inverse-secondary hover:text-on-inverse">
                        {link.label}
                      </a>
                    ) : (
                      <Link to={link.to} className="text-sm text-on-inverse-secondary hover:text-on-inverse">
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start gap-3 border-t border-on-inverse/15 pt-6 text-sm text-on-inverse-muted sm:flex-row sm:items-center sm:justify-between">
          <ThemeToggle />
          <div className="flex flex-col gap-1 sm:text-right">
            <p>Early access: we're building Zyro with feedback from store owners.</p>
            <p>&copy; 2026 Zyro. All rights reserved.</p>
          </div>
        </div>
      </div>
    </footer>
  )
}
