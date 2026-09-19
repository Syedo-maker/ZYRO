import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../../context/AuthContext'
import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import { apiFetch } from '../../lib/apiClient'
import { errorMessage } from '../../lib/ordersApi'
import { posApi } from '../../lib/posApi'

interface StaffMember {
  id: string
  userId: string
  email: string
  permissions: string[]
}

type Role = 'cashier' | 'manager'

// What each role may do at the register and in the back office; sent as the staff permissions.
const ROLES: Record<Role, { label: string; permissions: string[]; description: string }> = {
  cashier: {
    label: 'Cashier',
    permissions: ['pos_sell'],
    description: 'Rings up sales, holds and resumes carts, opens and closes their own shift. Discounts are limited to the percentage below.',
  },
  manager: {
    label: 'Manager',
    permissions: ['pos_sell', 'refunds', 'discounts_write', 'analytics_read', 'orders_write'],
    description: 'Everything a cashier does, plus returns and refunds, any discount, the daily summary and order management.',
  },
}

function describe(perms: string[]): string {
  if (perms.includes('refunds')) return 'Manager'
  if (perms.length === 1 && perms[0] === 'pos_sell') return 'Cashier'
  return perms.map((p) => p.replace('_', ' ')).join(', ')
}

/** The owner's page for the people who work the register, and the discount limit they work under. */
export function TeamPage() {
  const { activeStore } = useAuth()
  const storeId = activeStore?.id
  const isOwner = activeStore?.role === 'owner'

  const [staff, setStaff] = useState<StaffMember[] | null>(null)
  const [limit, setLimit] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'cashier' as Role })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!storeId || !isOwner) return
    try {
      const [list, session] = await Promise.all([apiFetch<StaffMember[]>(`/stores/${storeId}/staff`), posApi.session(storeId)])
      setStaff(list)
      setLimit(String(session.settings.maxCashierDiscountPercent))
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [storeId, isOwner])

  useEffect(() => {
    void load()
  }, [load])

  if (!activeStore) return <p className="text-sm text-text-secondary">Create a store first.</p>
  if (!isOwner) return <Alert tone="info">Only the store owner can manage the team.</Alert>

  async function add(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setBusy(true)
    try {
      await apiFetch(`/stores/${storeId}/staff`, {
        method: 'POST',
        body: {
          email: form.email.trim(),
          ...(form.password ? { password: form.password, name: form.name.trim() || undefined } : {}),
          permissions: ROLES[form.role].permissions,
        },
      })
      setMessage(`${form.email.trim()} was added as a ${ROLES[form.role].label.toLowerCase()}.`)
      setForm({ name: '', email: '', password: '', role: form.role })
      await load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(member: StaffMember) {
    setError(null)
    setMessage(null)
    try {
      await apiFetch(`/stores/${storeId}/staff/${member.id}`, { method: 'DELETE' })
      setMessage(`${member.email} no longer has access.`)
      await load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function saveLimit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    try {
      const saved = await posApi.updateSettings(storeId!, Number(limit))
      setLimit(String(saved.maxCashierDiscountPercent))
      setMessage(`Cashiers can now give up to ${saved.maxCashierDiscountPercent}% off.`)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="max-w-4xl flex flex-col gap-8">
      <div>
        <h1 className="font-display text-xl font-bold">Team and register</h1>
        <p className="text-sm text-text-secondary mt-1">
          People who work the register sign in at{' '}
          <a href="/pos" target="_blank" rel="noreferrer" className="font-semibold text-brand">
            /pos
          </a>{' '}
          with the email and password you set here.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}

      <section aria-labelledby="staff-heading" className="bg-white border border-border rounded-2xl">
        <h2 id="staff-heading" className="font-display text-base font-bold px-5 pt-5">
          Staff
        </h2>
        {!staff ? (
          <div className="p-5">
            <Spinner label="Loading team" />
          </div>
        ) : staff.length === 0 ? (
          <p className="p-5 text-sm text-text-secondary">No staff yet. Add your first cashier below.</p>
        ) : (
          <ul className="divide-y divide-border mt-2">
            {staff.map((m) => (
              <li key={m.id} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{m.email}</div>
                </div>
                <Badge tone="neutral">{describe(m.permissions)}</Badge>
                <button onClick={() => void remove(m)} className="text-sm font-semibold text-danger" aria-label={`Remove ${m.email}`}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form onSubmit={add} aria-labelledby="add-heading" className="bg-white border border-border rounded-2xl p-5 flex flex-col gap-4">
        <h2 id="add-heading" className="font-display text-base font-bold">
          Add a cashier or manager
        </h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Input id="staff-name" label="Name" maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input id="staff-email" label="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <Input
          id="staff-password"
          label="Starting password (leave empty if they already have a ZYRO account)"
          type="password"
          minLength={8}
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <fieldset className="grid sm:grid-cols-2 gap-3">
          <legend className="text-xs font-semibold text-text-secondary mb-2">Role</legend>
          {(Object.keys(ROLES) as Role[]).map((r) => (
            <label
              key={r}
              className={`rounded-xl border p-4 cursor-pointer flex flex-col gap-1 ${form.role === r ? 'border-brand bg-brand-soft' : 'border-border'}`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <input type="radio" name="role" checked={form.role === r} onChange={() => setForm({ ...form, role: r })} />
                {ROLES[r].label}
              </span>
              <span className="text-xs text-text-secondary">{ROLES[r].description}</span>
            </label>
          ))}
        </fieldset>
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? 'Adding...' : 'Add to team'}
          </Button>
        </div>
      </form>

      <form onSubmit={saveLimit} aria-labelledby="limit-heading" className="bg-white border border-border rounded-2xl p-5 flex flex-col gap-4">
        <h2 id="limit-heading" className="font-display text-base font-bold">
          Cashier discount limit
        </h2>
        <p className="text-sm text-text-secondary">
          The most a cashier can take off a sale without a manager, as a percentage of the sale. You and managers are not limited.
        </p>
        <div className="flex items-end gap-3">
          <div className="w-40">
            <Input id="limit" label="Percent" type="number" min="0" max="100" step="0.5" required value={limit} onChange={(e) => setLimit(e.target.value)} />
          </div>
          <Button type="submit" variant="secondary">
            Save
          </Button>
        </div>
      </form>
    </div>
  )
}
