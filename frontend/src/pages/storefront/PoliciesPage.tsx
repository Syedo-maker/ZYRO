import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../../context/StoreContext'
import { Alert } from '../../components/ui/Alert'
import { Spinner } from '../../components/ui/Spinner'
import { errorMessage } from '../../lib/ordersApi'
import { usePageMeta } from '../../lib/pageMeta'
import { POLICY_TITLES, policiesApi, type StorePolicy } from '../../lib/policiesApi'

/**
 * The shop's own policies, as its owner wrote them in Settings: returns and refunds, shipping,
 * privacy and terms. Shown as plain text (paragraph breaks kept), never as HTML. A shop that has not
 * written any says so, and points to how to reach it and to ZYRO's own privacy policy.
 */
export function PoliciesPage() {
  const store = useStore()
  const [policies, setPolicies] = useState<StorePolicy[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  usePageMeta({ title: `Policies | ${store.name}`, description: `Returns, refunds, shipping, privacy and terms of sale at ${store.name}.` })

  useEffect(() => {
    policiesApi
      .list(store.id)
      .then((r) => setPolicies(r.policies))
      .catch((e) => setError(errorMessage(e, 'Could not load this shop’s policies.')))
  }, [store.id])

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-10">
      <h1 className="font-display text-3xl font-extrabold tracking-tight text-text">Shop policies</h1>
      <p className="mt-2 text-sm text-text-secondary">How {store.name} handles orders, delivery, returns and your details.</p>

      {error && (
        <div className="mt-6">
          <Alert>{error}</Alert>
        </div>
      )}
      {!policies && !error && (
        <div className="mt-6">
          <Spinner label="Loading the shop’s policies" />
        </div>
      )}

      {policies && policies.length === 0 && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5 text-sm text-text-secondary">
          <p>{store.name} has not published its policies yet. For questions about an order, contact the shop using the details in your order confirmation.</p>
          <p className="mt-2">
            How ZYRO, which runs this shop’s website, handles your details:{' '}
            <Link to="/privacy" className="text-text underline underline-offset-2">ZYRO privacy policy</Link>.
          </p>
        </div>
      )}

      {policies && policies.length > 0 && (
        <>
          <nav aria-label="Policies on this page" className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {policies.map((p) => (
              <a key={p.kind} href={`#${p.kind}`} className="text-text-secondary underline underline-offset-4 hover:text-text">
                {POLICY_TITLES[p.kind]}
              </a>
            ))}
          </nav>
          {policies.map((p) => (
            <section key={p.kind} id={p.kind} aria-labelledby={`${p.kind}-h`} className="mt-10 scroll-mt-24">
              <h2 id={`${p.kind}-h`} className="font-display text-xl font-bold text-text">{POLICY_TITLES[p.kind]}</h2>
              <p className="mt-1 text-xs text-text-muted">Last updated {new Date(p.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              <div className="mt-3 whitespace-pre-line break-words text-base leading-relaxed text-text-secondary">{p.body}</div>
            </section>
          ))}
          <p className="mt-12 border-t border-border pt-6 text-sm text-text-muted">
            {store.name} wrote these policies. ZYRO runs the shop’s website:{' '}
            <Link to="/privacy" className="underline underline-offset-2 hover:text-text">ZYRO privacy policy</Link>.
          </p>
        </>
      )}
    </div>
  )
}
