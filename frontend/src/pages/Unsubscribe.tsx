import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Alert } from '../components/ui/Alert'
import { Spinner } from '../components/ui/Spinner'
import { AuthShell, AUTH_TITLE } from '../components/ui/AuthShell'
import { ApiError, apiFetch } from '../lib/apiClient'
import { usePageMeta } from '../lib/pageMeta'

/** The API's own explanation ("This unsubscribe link is not valid..."), which says what to do instead. */
const explain = (e: unknown) => (e instanceof ApiError ? (e.detail ?? e.message) : 'Something went wrong. Please try again.')

interface State {
  storeName: string
  unsubscribed: boolean
}

/**
 * Where the "To stop these reminders" link in a cart reminder leads. Opening it changes nothing: the
 * shopper presses the button, so a mail scanner that opens every link unsubscribes nobody. The same
 * link can turn the reminders back on. (The email app's own unsubscribe button posts straight to the
 * API and never opens this page.)
 */
export function UnsubscribePage() {
  const [params] = useSearchParams()
  const token = params.get('t') ?? ''
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  usePageMeta({ title: 'Email reminders | ZYRO', description: 'Stop or restart a shop’s cart reminder emails.', robots: 'noindex' })

  useEffect(() => {
    apiFetch<State>(`/unsubscribe?t=${encodeURIComponent(token)}`)
      .then(setState)
      .catch((e) => setError(explain(e)))
  }, [token])

  async function change(method: 'POST' | 'DELETE') {
    setBusy(true)
    setError(null)
    try {
      setState(await apiFetch<State>(`/unsubscribe?t=${encodeURIComponent(token)}`, { method, body: {} }))
    } catch (e) {
      setError(explain(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <div className="flex flex-col gap-4">
        <h1 className={AUTH_TITLE}>Cart reminder emails</h1>
        {error && <Alert>{error}</Alert>}
        {!state && !error && <Spinner label="Checking your link" />}
        {state && !state.unsubscribed && (
          <>
            <p className="text-sm text-text-secondary">
              {state.storeName} emails you a reminder when you leave items in your cart. Stop these reminders from {state.storeName}?
            </p>
            <Button type="button" disabled={busy} onClick={() => void change('POST')}>
              {busy ? 'Saving...' : 'Stop these emails'}
            </Button>
          </>
        )}
        {state?.unsubscribed && (
          <>
            <Alert tone="success">You will not get any more cart reminders from {state.storeName}.</Alert>
            <p className="text-sm text-text-secondary">Password reset emails, which you ask for yourself, are not affected.</p>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void change('DELETE')}>
              {busy ? 'Saving...' : 'Changed your mind? Send them again'}
            </Button>
          </>
        )}
      </div>
    </AuthShell>
  )
}
