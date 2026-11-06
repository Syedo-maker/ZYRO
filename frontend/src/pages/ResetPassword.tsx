import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, buttonStyles } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Alert } from '../components/ui/Alert'
import { AuthShell, AUTH_LINK, AUTH_TITLE } from '../components/ui/AuthShell'
import { ApiError, apiFetch, authErrorMessage } from '../lib/apiClient'

/**
 * Choosing a new password from the emailed link (B1): `?token=` from the link, and `?store=` when the
 * shopper asked from a store's sign-in page. The same password rules as signing up (8 characters at
 * least); the server checks them again and decides whether the link is still good.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const storeId = params.get('store')
  const loginPath = storeId && /^[a-z0-9]{10,40}$/.test(storeId) ? `/store/${storeId}/account/login` : '/login'
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    setSubmitting(true)
    try {
      const res = await apiFetch<{ message: string }>('/auth/reset-password', { method: 'POST', body: { token, password } })
      setDone(res.message)
    } catch (err) {
      // A bad link has its own sentence from the server; any other refusal here is the password rules.
      if (err instanceof ApiError && err.status === 400) {
        setError(err.detail && /invalid or has expired/.test(err.detail) ? err.detail : 'Choose a password of 8 to 72 characters.')
      } else setError(authErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell>
      <div>
        <h1 className={AUTH_TITLE}>Choose a new password</h1>
        <p className="mt-2 text-sm text-text-secondary">At least 8 characters. Every device signed in to your account will be signed out.</p>
      </div>

      {done ? (
        <>
          <Alert tone="success">{done}</Alert>
          <Link to={loginPath} className={buttonStyles({ className: 'w-full' })}>
            Log in
          </Link>
        </>
      ) : !token ? (
        <Alert>This page needs the link from the reset email. Ask for a new one if it is lost.</Alert>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input id="password" type="password" label="New password" required minLength={8} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <Input id="confirm" type="password" label="Type it again" required minLength={8} maxLength={72} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" loading={submitting}>
            {submitting ? 'Saving…' : 'Save new password'}
          </Button>
        </form>
      )}

      {!done && (
        <p className="text-center text-sm text-text-secondary">
          Link not working?{' '}
          <Link to={storeId ? `/forgot-password?store=${encodeURIComponent(storeId)}` : '/forgot-password'} className={AUTH_LINK}>
            Ask for a new one
          </Link>
        </p>
      )}
    </AuthShell>
  )
}
