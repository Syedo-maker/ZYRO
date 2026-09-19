import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
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
    <div className="min-h-screen flex items-center justify-center px-4 bg-text">
      <div className="w-full max-w-md bg-white rounded-2xl p-8 flex flex-col gap-5">
        <div>
          <div className="font-display text-2xl font-bold">ZYRO</div>
          <h1 className="font-display text-lg font-semibold mt-4">Sign in to the register</h1>
          <p className="text-sm text-text-secondary mt-1">Use the account your manager gave you.</p>
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
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting} className="h-12">
            {submitting ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  )
}
