import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { AuthShell, AUTH_LINK, AUTH_TITLE } from '../components/ui/AuthShell'
import { authErrorMessage } from '../lib/apiClient'
import { landingPathFor, rememberedExperience } from '../lib/experience'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const session = await login({ email, password })
      // Issue 2: a shopper logging in has no shop, so the dashboard is the wrong place to land.
      navigate(landingPathFor({ hasStore: session.stores.length > 0, preference: session.user.preferredExperience ?? rememberedExperience() }))
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell>
        <div>
          <h1 className={AUTH_TITLE}>Log in</h1>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            id="email"
            type="email"
            label="Email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <Input
            id="password"
            type="password"
            label="Password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <div className="-mt-2 text-right">
            <Link to="/forgot-password" className="text-sm font-semibold text-text-secondary underline-offset-4 hover:text-text hover:underline">
              Forgot password?
            </Link>
          </div>

          {error && <p role="alert" className="text-sm text-danger">{error}</p>}

          <Button type="submit" disabled={submitting}>
            {submitting ? 'Logging in…' : 'Log in'}
          </Button>
        </form>

        <p className="text-sm text-text-secondary text-center">
          Don&apos;t have a store yet?{' '}
          <Link to="/register" className={AUTH_LINK}>
            Create one
          </Link>{' '}
          or{' '}
          <Link to="/shop" className={AUTH_LINK}>
            browse shops
          </Link>
        </p>
    </AuthShell>
  )
}
