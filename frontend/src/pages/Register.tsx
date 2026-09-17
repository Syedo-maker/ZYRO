import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { ApiError } from '../lib/apiClient'

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
      await register({ email, password, storeName, storeSlug })
      navigate('/admin/products')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white border border-border rounded-2xl p-8 flex flex-col gap-5">
        <div>
          <div className="font-display text-2xl font-bold">ZYRO</div>
          <h1 className="font-display text-lg font-semibold mt-4">Create your store</h1>
          <p className="text-sm text-text-secondary mt-1">
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

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating your store…' : 'Create store'}
          </Button>
        </form>

        <p className="text-sm text-text-secondary text-center">
          Already have an account?{' '}
          <Link to="/login" className="text-brand font-semibold">
            Log in
          </Link>
        </p>
      </div>
    </div>
  )
}
