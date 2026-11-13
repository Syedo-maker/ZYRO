import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

const KEY = 'zyro:cookie-notice'

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/**
 * A short notice about cookies and browser storage, shown once to visitors of the public pages and
 * storefronts. ZYRO uses only what it needs to work (a sign-in cookie, a guest cart id and a few
 * preferences: see the Privacy Policy, "Cookies and storage in your browser"), and nothing for
 * advertising or tracking, so there is nothing to accept or refuse: the notice informs, and OK hides
 * it. Merchants' own screens (the dashboard and the register) do not show it.
 */
export function CookieNotice() {
  const { pathname } = useLocation()
  const [hidden, setHidden] = useState(seen)
  if (hidden || pathname.startsWith('/admin') || pathname.startsWith('/pos')) return null

  function dismiss() {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      // Storage blocked: the notice simply comes back next visit.
    }
    setHidden(true)
  }

  return (
    <aside
      aria-label="Cookies"
      className="fixed bottom-4 left-4 right-20 z-40 flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-xs text-text-secondary shadow-[var(--shadow-depth-md)] sm:right-auto sm:max-w-sm"
    >
      <p>
        We use only the cookies and storage ZYRO needs to work, such as keeping you signed in and your cart. No advertising or tracking.{' '}
        <Link to="/privacy#storage" className="text-text underline underline-offset-2">Details</Link>
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded-full border border-text/25 px-3 py-1.5 font-semibold text-text hover:border-text/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        OK
      </button>
    </aside>
  )
}
