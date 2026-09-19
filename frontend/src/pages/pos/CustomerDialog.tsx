import { useEffect, useState, type FormEvent } from 'react'
import { usePos } from '../../context/PosContext'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { errorMessage } from '../../lib/ordersApi'
import { posApi } from '../../lib/posApi'
import type { PosCustomer } from '../../types/pos'

/** Attach a customer to the sale: find one already known to this store, or add a new one. */
export function CustomerDialog({ onClose }: { onClose: () => void }) {
  const { storeId, customer, setCustomer } = usePos()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PosCustomer[]>([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', phone: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      posApi
        .searchCustomers(storeId, q.trim() || undefined)
        .then((r) => {
          if (!cancelled) setResults(r)
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(errorMessage(err))
        })
    }, q ? 250 : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [storeId, q])

  function pick(c: PosCustomer) {
    setCustomer(c)
    onClose()
  }

  async function create(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      pick(
        await posApi.createCustomer(storeId, {
          name: form.name.trim() || undefined,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
        })
      )
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open title={adding ? 'New customer' : 'Customer'} onClose={onClose} size="lg">
      {adding ? (
        <form onSubmit={create} className="flex flex-col gap-4">
          <Input id="cust-name" label="Name" maxLength={120} autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input id="cust-email" label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input id="cust-phone" label="Phone" type="tel" maxLength={40} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
              Back
            </Button>
            <Button type="submit" className="flex-1" disabled={busy || (!form.name.trim() && !form.email.trim() && !form.phone.trim())}>
              {busy ? 'Saving...' : 'Add and select'}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <Input id="cust-search" label="Search by name, email or phone" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
          {error && <Alert>{error}</Alert>}
          <ul className="max-h-64 overflow-y-auto divide-y divide-border border border-border rounded-[10px]">
            {results.length === 0 && <li className="px-4 py-3 text-sm text-text-secondary">No customers found.</li>}
            {results.map((c) => (
              <li key={c.id}>
                <button onClick={() => pick(c)} className="w-full text-left px-4 py-3 hover:bg-bg">
                  <span className="block text-sm font-semibold">{c.name ?? c.email ?? c.phone}</span>
                  <span className="block text-xs text-text-secondary">{[c.email, c.phone].filter(Boolean).join('  ')}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-3">
            {customer && (
              <Button
                variant="danger"
                onClick={() => {
                  setCustomer(null)
                  onClose()
                }}
              >
                Remove customer
              </Button>
            )}
            <Button variant="secondary" className="flex-1" onClick={() => setAdding(true)}>
              Add a new customer
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
