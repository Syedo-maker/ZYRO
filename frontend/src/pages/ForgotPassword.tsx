import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Alert } from '../components/ui/Alert'
import { AuthShell, AUTH_LINK, AUTH_TITLE } from '../components/ui/AuthShell'
import { apiFetch, authErrorMessage } from '../lib/apiClient'

/**
 * Asking for a password reset link (B1). The answer is the same whether or not the email has an account,
 * so the page always says the same thing once the request is accepted. Opened from any sign-in page; a
 * shopper's store sign-in passes `?store=<id>` so the link brings them back to that store.
 */
export function ForgotPasswordPage() {
  const [params] = useSearchParams()
  const storeId = params.get('store') ?? undefined
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const backTo = storeId ? `/store/${storeId}/account/login` : '/login'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await apiFetch<{ message: string }>('/auth/forgot-password', { method: 'POST', body: { email, ...(storeId ? { storeId } : {}) } })
      setSent(res.message)
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell>
      <div>
        <h1 className={AUTH_TITLE}>Forgot your password?</h1>
        <p className="mt-2 text-sm text-text-secondary">Enter the email you sign in with and we will send you a link to choose a new password.</p>
      </div>

      {sent ? (
        <Alert tone="success">{sent}</Alert>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input id="email" type="email" label="Email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" loading={submitting}>
            {submitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}

      <p className="text-center text-sm text-text-secondary">
        Remembered it?{' '}
        <Link to={backTo} className={AUTH_LINK}>
          Back to log in
        </Link>
      </p>
    </AuthShell>
  )
}
