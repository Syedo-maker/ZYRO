import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import { useStore } from '../../../context/StoreContext'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { authErrorMessage } from '../../../lib/apiClient'

/** Only ever send the shopper back to a page of this store, never to an address taken from the link. */
function safeNext(next: string | null, storeId: string): string | null {
  return next && next.startsWith(`/store/${storeId}/`) && !next.startsWith('//') ? next : null
}

/** Sign in or create an account at a store. The same page serves both, chosen by `mode`. */
export function CustomerAuthPage({ mode }: { mode: 'login' | 'register' }) {
  const store = useStore()
  const { login, registerCustomer, isAuthenticated, isLoading } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'), store.id)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const register = mode === 'register'
  const where = next ?? `/store/${store.id}/account`
  const suffix = next ? `?next=${encodeURIComponent(next)}` : ''

  if (isLoading) return null
  if (isAuthenticated) return <Navigate to={where} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (register) await registerCustomer({ email, password, name: name.trim() || undefined })
      else await login({ email, password })
      navigate(where)
    } catch (err) {
      setError(authErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-border bg-white p-8">
      <h1 className="font-display text-2xl font-bold">{register ? 'Create your account' : 'Sign in'}</h1>
      <p className="mt-1 text-sm text-text-secondary">
        {register
          ? `Track your orders and review what you buy at ${store.name}. You can also check out as a guest without an account.`
          : `Welcome back to ${store.name}.`}
      </p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        {register && <Input id="name" label="Name (optional)" autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />}
        <Input id="email" type="email" label="Email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input
          id="password"
          type="password"
          label={register ? 'Password (at least 8 characters)' : 'Password'}
          required
          minLength={register ? 8 : undefined}
          maxLength={72}
          autoComplete={register ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="h-12">
          {busy ? (register ? 'Creating account...' : 'Signing in...') : register ? 'Create account' : 'Sign in'}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-text-secondary">
        {register ? 'Already have an account? ' : 'New here? '}
        <Link to={`/store/${store.id}/account/${register ? 'login' : 'register'}${suffix}`} className="font-semibold text-brand">
          {register ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </div>
  )
}
