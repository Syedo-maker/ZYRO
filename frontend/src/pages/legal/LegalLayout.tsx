import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Wordmark } from '../../components/ui/Wordmark'
import { LEGAL } from '../../lib/legal'

/**
 * The frame for the Terms of Service and the Privacy Policy: plain text, set to be read, with every
 * section reachable from a list at the top. Written for the people they bind, so in plain words.
 */
export function LegalLayout({ title, intro, sections }: { title: string; intro: ReactNode; sections: { id: string; heading: string; body: ReactNode }[] }) {
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="rounded-[10px] text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <Wordmark className="text-xl" />
          </Link>
          <nav aria-label="Legal" className="flex gap-4 text-sm font-semibold">
            <Link to="/terms" className="text-text-secondary hover:text-text">Terms</Link>
            <Link to="/privacy" className="text-text-secondary hover:text-text">Privacy</Link>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-text">{title}</h1>
        <p className="mt-2 text-sm text-text-muted">Last updated {LEGAL.updated}</p>
        <div className="mt-6 space-y-4 text-base leading-relaxed text-text-secondary">{intro}</div>

        <nav aria-label="On this page" className="mt-8 rounded-2xl border border-border bg-surface p-5">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-text-muted">On this page</h2>
          <ol className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-text-secondary underline-offset-4 hover:text-text hover:underline">
                  {i + 1}. {s.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {sections.map((s, i) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="mt-10 scroll-mt-6">
            <h2 id={`${s.id}-h`} className="font-display text-xl font-bold text-text">
              {i + 1}. {s.heading}
            </h2>
            <div className="mt-3 space-y-3 text-base leading-relaxed text-text-secondary [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-text">{s.body}</div>
          </section>
        ))}

        <p className="mt-12 border-t border-border pt-6 text-sm text-text-muted">
          Questions about this page: <a href={`mailto:${LEGAL.contactEmail}`} className="text-text underline underline-offset-4">{LEGAL.contactEmail}</a>
        </p>
      </main>
    </div>
  )
}
