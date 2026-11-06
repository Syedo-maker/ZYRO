import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { AuthShell, AUTH_TITLE } from '../../components/ui/AuthShell'
import { authErrorMessage } from '../../lib/apiClient'

/** Sign-in for the till. Same accounts as the admin, but it lands on the register. */
export function PosLoginPage() {
  const { login, isAuthenticated, isLoading } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (isLoading) return null
  if (isAuthenticated) return <Navigate to="/pos" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login({ email, password })
      navigate('/pos')
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell>
        <div>
          <h1 className={AUTH_TITLE}>Sign in to the register</h1>
          <p className="text-sm text-text-secondary mt-2">Use the account your manager gave you.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input id="email" type="email" label="Email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
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
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting} className="h-12">
            {submitting ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
    </AuthShell>
  )
}
