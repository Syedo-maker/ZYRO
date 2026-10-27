import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { landingPathFor, rememberedExperience } from '../../lib/experience'

const LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
]

/**
 * The landing page's own navigation. Sticky, and it gains a background only once the visitor has
 * scrolled off the hero, so it floats over the dark hero at the top instead of cutting a line
 * across it.
 *
 * On a phone the links collapse into a disclosure button. The menu is a real button with
 * `aria-expanded` and `aria-controls`, closes on Escape, and the links inside it are ordinary
 * anchors, so keyboard and screen-reader users get the same navigation as everyone else.
 */
export function LandingNav() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const { isLoading, isAuthenticated, stores, user } = useAuth()
  // Signed in: one way back to where they belong, instead of "Log in" and "Start free". Having a
  // shop decides which (lib/experience.ts); the stated preference only breaks the tie.
  const signedIn = !isLoading && isAuthenticated
  const home = signedIn ? landingPathFor({ hasStore: stores.length > 0, preference: user?.preferredExperience ?? rememberedExperience() }) : null
  const homeLabel = home?.startsWith('/admin') ? 'Go to dashboard' : 'Browse shops'

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    // Dark at rest, not transparent: the bar sits above the hero rather than over it, so a
    // transparent background would put cream text on the page's cream and make the whole nav
    // invisible until the visitor scrolled. Scrolling only adds the blur and the shadow.
    <header
      className={`sticky top-0 z-50 bg-inverse transition-shadow duration-300 ${
        scrolled || open ? 'shadow-lg shadow-black/20 backdrop-blur-sm' : ''
      }`}
    >
      <nav aria-label="Main" className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
        <Link to="/" className="font-display text-lg font-extrabold text-on-inverse">
          ZYRO
        </Link>

        <ul role="list" className="ml-6 hidden items-center gap-6 lg:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                className="rounded text-sm font-medium text-on-inverse-secondary transition-colors hover:text-on-inverse focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-on-inverse"
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        {/* Nothing until we know who this is, so a signed-in owner never sees "Log in" flash first. */}
        <div className="ml-auto hidden items-center gap-3 lg:flex">
          {isLoading ? null : home ? (
            <Link
              to={home}
              className="rounded-[10px] bg-bg px-4 py-2 text-sm font-bold text-text transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-inverse"
            >
              {homeLabel}
            </Link>
          ) : (
            <>
              <Link
                to="/login"
                className="rounded-[10px] px-3 py-2 text-sm font-semibold text-on-inverse-secondary transition-colors hover:text-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-inverse"
              >
                Log in
              </Link>
              <Link
                to="/register"
                className="rounded-[10px] bg-bg px-4 py-2 text-sm font-bold text-text transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-inverse"
              >
                Start free
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="landing-mobile-menu"
          className="ml-auto rounded-[10px] p-2 text-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-inverse lg:hidden"
        >
          <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            {open ? <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /> : <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />}
          </svg>
        </button>
      </nav>

      {open && (
        <div id="landing-mobile-menu" className="border-t border-on-inverse/15 lg:hidden">
          <ul role="list" className="mx-auto flex w-full max-w-6xl flex-col px-4 py-2 sm:px-6">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a onClick={() => setOpen(false)} href={l.href} className="block rounded px-2 py-3 text-sm font-medium text-on-inverse-secondary">
                  {l.label}
                </a>
              </li>
            ))}
            <li className="mt-1 flex gap-3 px-2 pb-3 pt-2">
              {isLoading ? null : home ? (
                <Link to={home} onClick={() => setOpen(false)} className="rounded-[10px] bg-bg px-4 py-2 text-sm font-bold text-text">
                  {homeLabel}
                </Link>
              ) : (
                <>
                  <Link to="/login" onClick={() => setOpen(false)} className="rounded-[10px] border border-on-inverse-muted px-4 py-2 text-sm font-semibold text-on-inverse">
                    Log in
                  </Link>
                  <Link to="/register" onClick={() => setOpen(false)} className="rounded-[10px] bg-bg px-4 py-2 text-sm font-bold text-text">
                    Start free
                  </Link>
                </>
              )}
            </li>
          </ul>
        </div>
      )}
    </header>
  )
}
