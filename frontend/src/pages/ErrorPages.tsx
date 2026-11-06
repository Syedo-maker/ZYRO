import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link, matchPath, useLocation } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { buttonStyles } from '../components/ui/Button'
import { Wordmark } from '../components/ui/Wordmark'
import { useAuth } from '../context/AuthContext'
import { landingPathFor, rememberedExperience } from '../lib/experience'

/**
 * The 404 page and the general error page (B2). Both send the visitor back to the right home: inside a
 * shop, that shop's home; inside the register, the register; a signed-in owner or staff member, their
 * dashboard (or the shop directory for a shopper); anyone else, the landing page. Neither ever shows a
 * technical detail: the error itself goes to the browser console for whoever is debugging, nowhere else.
 */

function useHome(): { to: string; label: string } {
  const { pathname } = useLocation()
  const { isAuthenticated, stores, user } = useAuth()
  const store = matchPath('/store/:storeId/*', pathname)?.params.storeId
  if (store) return { to: `/store/${store}`, label: 'Back to the shop' }
  const register = matchPath('/pos/:storeId/*', pathname)?.params.storeId
  if (register && register !== 'login') return { to: `/pos/${register}`, label: 'Back to the register' }
  if (isAuthenticated) {
    const to = landingPathFor({ hasStore: stores.length > 0, preference: user?.preferredExperience ?? rememberedExperience() })
    return { to, label: to.startsWith('/admin') ? 'Go to your dashboard' : 'Go to the shops' }
  }
  return { to: '/', label: 'Go to the home page' }
}

function ErrorLayout({ code, title, body }: { code: string; title: ReactNode; body: string }) {
  const home = useHome()
  return (
    <main className="relative flex min-h-[70vh] items-center justify-center overflow-hidden px-4 py-16">
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/3 h-80 w-80 -translate-x-1/2 rounded-full bg-accent/10 blur-[110px]" />
      <div className="relative flex max-w-lg flex-col items-center gap-5 text-center">
        <Wordmark className="text-xl text-text" />
        <p aria-hidden="true" className="font-serif text-[clamp(5rem,18vw,9rem)] italic leading-none text-accent">
          {code}
        </p>
        <h1 className="font-display text-h2 font-bold">{title}</h1>
        <p className="text-text-secondary">{body}</p>
        <Link to={home.to} className={buttonStyles({ variant: 'accent', size: 'lg', className: 'group mt-2' })}>
          {home.label}
          <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2.25} />
        </Link>
      </div>
    </main>
  )
}

/** Any address the app does not know. Valid routes and their redirects are matched before it. */
export function NotFoundPage() {
  return <ErrorLayout code="404" title="Page not found" body="This page does not exist, or it has moved. Check the address, or go back home." />
}

function CrashPage() {
  return <ErrorLayout code="Oops" title="Something went wrong" body="This page hit a problem and could not load. Nothing you entered was lost on our side; please try again." />
}

/**
 * Catches a page that throws while rendering, so one broken page shows the error page instead of a blank
 * screen. `resetKey` (the current address) clears it when the visitor goes somewhere else.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean; key: string }> {
  state = { failed: false, key: this.props.resetKey }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  // A new address clears the failure before rendering, so the next page gets its chance.
  static getDerivedStateFromProps(props: { resetKey: string }, state: { key: string }) {
    return props.resetKey === state.key ? null : { failed: false, key: props.resetKey }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page error', error, info.componentStack)
  }

  render() {
    return this.state.failed ? <CrashPage /> : this.props.children
  }
}

/** The boundary, keyed to the current address so moving to another page recovers from a broken one. */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>
}
