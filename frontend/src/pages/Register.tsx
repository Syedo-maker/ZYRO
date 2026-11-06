import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { saveExperience } from '../lib/experience'
import { Button } from '../components/ui/Button'
import { FIELD, Input } from '../components/ui/Input'
import { AuthShell, AUTH_LINK, AUTH_TITLE } from '../components/ui/AuthShell'
import { authErrorMessage } from '../lib/apiClient'
import { DEFAULT_STORE_CURRENCY, STORE_CURRENCIES } from '../lib/currencies'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50)
}

export function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [storeName, setStoreName] = useState('')
  const [storeSlug, setStoreSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [currency, setCurrency] = useState<string>(DEFAULT_STORE_CURRENCY)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function handleStoreNameChange(value: string) {
    setStoreName(value)
    if (!slugTouched) setStoreSlug(slugify(value))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await register({ email, password, storeName, storeSlug, currency })
      // Issue 2: they just opened a shop, so that is the experience they are in now.
      await saveExperience('owner', true)
      navigate('/admin/products')
    } catch (err) {
      setError(authErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell>
        <div>
          <h1 className={AUTH_TITLE}>Create your store</h1>
          <p className="text-sm text-text-secondary mt-2">
            Free to start; your store and account are created together.
          </p>
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
            minLength={8}
            maxLength={72}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          <Input
            id="storeName"
            label="Store name"
            required
            value={storeName}
            onChange={(e) => handleStoreNameChange(e.target.value)}
            autoComplete="organization"
          />
          <Input
            id="storeSlug"
            label="Store URL"
            required
            pattern="[a-z0-9\-]{3,50}"
            title="3-50 lowercase letters, digits, or hyphens"
            value={storeSlug}
            onChange={(e) => {
              setSlugTouched(true)
              setStoreSlug(e.target.value)
            }}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="currency" className="text-xs font-semibold text-text-secondary">
              Currency your prices are in
            </label>
            <select
              id="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={`h-11 border-border-input ${FIELD}`}
            >
              {STORE_CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
            <span className="text-xs text-text-secondary">You can change it in Settings until your first sale.</span>
          </div>

          {error && <p role="alert" className="text-sm text-danger">{error}</p>}

          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating your store…' : 'Create store'}
          </Button>
          <p className="text-xs text-text-secondary">
            By creating a store you agree to the{' '}
            <Link to="/terms" className="font-semibold text-text underline underline-offset-2">Terms of Service</Link> and the{' '}
            <Link to="/privacy" className="font-semibold text-text underline underline-offset-2">Privacy Policy</Link>.
          </p>
        </form>

        <p className="text-sm text-text-secondary text-center">
          Already have an account?{' '}
          <Link to="/login" className={AUTH_LINK}>
            Log in
          </Link>
        </p>
    </AuthShell>
  )
}
