import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../../context/AuthContext'
import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import { formatDate, formatMoney } from '../../lib/format'
import { errorMessage } from '../../lib/ordersApi'
import { discountsApi } from '../../lib/shopApi'
import { MarketingInsights } from './MarketingInsights'
import { storefrontApi } from '../../lib/storefrontApi'
import type { DiscountCode, DiscountStatus } from '../../types/shop'

const STATUS: Record<DiscountStatus, { label: string; tone: 'success' | 'neutral' | 'warning' | 'danger' }> = {
  active: { label: 'Active', tone: 'success' },
  inactive: { label: 'Switched off', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'warning' },
  used_up: { label: 'Used up', tone: 'warning' },
}

/** yyyy-mm-dd for a date input, from an ISO instant, in the merchant's own zone. */
const toDateInput = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-CA') : '')
/** The end of the chosen local day as an instant, so "expires on the 30th" includes the 30th. */
const endOfDay = (date: string) => new Date(`${date}T23:59:59`).toISOString()

function CreateDialog({ storeId, currency, onClose, onCreated }: { storeId: string; currency: string; onClose: () => void; onCreated: () => void }) {
  const [code, setCode] = useState('')
  const [type, setType] = useState<'percentage' | 'fixed'>('percentage')
  const [value, setValue] = useState('')
  const [min, setMin] = useState('')
  const [limit, setLimit] = useState('')
  const [expires, setExpires] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await discountsApi.create(storeId, {
        code: code.trim(),
        type,
        value: Number(value),
        minSubtotal: min ? Number(min) : undefined,
        usageLimit: limit ? Number(limit) : undefined,
        expiresAt: expires ? endOfDay(expires) : undefined,
      })
      onCreated()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open title="New discount code" onClose={onClose} size="lg">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input id="dc-code" label="Code (letters, digits, - and _)" required minLength={3} maxLength={30} autoFocus value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <fieldset className="flex gap-2">
          <legend className="sr-only">Type</legend>
          {(['percentage', 'fixed'] as const).map((t) => (
            <label key={t} className={`flex-1 cursor-pointer rounded-[10px] border px-3 py-3 text-center text-sm font-semibold ${type === t ? 'border-brand bg-brand-soft text-brand' : 'border-border'}`}>
              <input type="radio" name="dc-type" className="sr-only" checked={type === t} onChange={() => setType(t)} />
              {t === 'percentage' ? 'Percent off' : `Amount off (${currency})`}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input id="dc-value" label={type === 'percentage' ? 'Percent (1 to 100)' : 'Amount'} type="number" required min="0.01" max={type === 'percentage' ? 100 : undefined} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
          <Input id="dc-min" label="Minimum spend (optional)" type="number" min="0" step="0.01" value={min} onChange={(e) => setMin(e.target.value)} />
          <Input id="dc-limit" label="Usage limit (optional)" type="number" min="1" step="1" value={limit} onChange={(e) => setLimit(e.target.value)} />
          <Input id="dc-expires" label="Last day (optional)" type="date" min={new Date().toLocaleDateString('en-CA')} value={expires} onChange={(e) => setExpires(e.target.value)} />
        </div>
        <p className="text-xs text-text-secondary">One code per order. The discount comes off the items only; shipping is never discounted.</p>
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="flex-1" disabled={busy}>{busy ? 'Creating...' : 'Create code'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

function EditDialog({ storeId, code, onClose, onSaved }: { storeId: string; code: DiscountCode; onClose: () => void; onSaved: () => void }) {
  const [limit, setLimit] = useState(code.usageLimit?.toString() ?? '')
  const [min, setMin] = useState(code.minSubtotal?.toString() ?? '')
  const [expires, setExpires] = useState(toDateInput(code.expiresAt))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await discountsApi.update(storeId, code.id, {
        usageLimit: limit ? Number(limit) : null,
        minSubtotal: min ? Number(min) : null,
        expiresAt: expires ? endOfDay(expires) : null,
      })
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open title={`Edit ${code.code}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-xs text-text-secondary">The code and its discount cannot be changed once created; make a new code instead. Empty means no limit.</p>
        <Input id="ed-limit" label={`Usage limit (used ${code.usageCount} times)`} type="number" min={Math.max(1, code.usageCount)} step="1" value={limit} onChange={(e) => setLimit(e.target.value)} />
        <Input id="ed-min" label="Minimum spend" type="number" min="0" step="0.01" value={min} onChange={(e) => setMin(e.target.value)} />
        <Input id="ed-exp" label="Last day" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="flex-1" disabled={busy}>{busy ? 'Saving...' : 'Save'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Discount codes: what exists, how much each has been used, and switching them on and off. */
export function MarketingPage() {
  const { activeStore } = useAuth()
  const storeId = activeStore?.id
  const [codes, setCodes] = useState<DiscountCode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<DiscountCode | null>(null)
  const [currency, setCurrency] = useState('USD')

  const load = useCallback(async () => {
    if (!storeId) return
    setCodes(await discountsApi.list(storeId))
  }, [storeId])

  useEffect(() => {
    load().catch((e) => setError(errorMessage(e)))
  }, [load])

  useEffect(() => {
    if (!storeId) return
    storefrontApi.getStore(storeId).then((s) => setCurrency(s.currency)).catch(() => undefined)
  }, [storeId])

  async function toggle(c: DiscountCode) {
    setError(null)
    try {
      await discountsApi.update(storeId!, c.id, { active: !c.active })
      setNotice(`${c.code} is now ${c.active ? 'switched off' : 'switched on'}.`)
      await load()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  if (!activeStore) return <p className="text-sm text-text-secondary">Create a store first.</p>

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Marketing</h1>
          <p className="mt-1 text-sm text-text-secondary">Discount codes work on the online store and at the register. One code per order.</p>
        </div>
        <Button onClick={() => setCreating(true)}>+ New discount code</Button>
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {codes === null && !error && <Spinner label="Loading discount codes" />}

      {codes?.length === 0 && (
        <div className="rounded-2xl border border-border bg-white px-6 py-14 text-center">
          <h2 className="font-display text-base font-bold">No discount codes yet</h2>
          <p className="mt-1 text-sm text-text-secondary">Create a code to run a sale or thank a customer.</p>
        </div>
      )}

      {codes && codes.length > 0 && (
        // `relative` keeps the screen-reader-only header text (absolutely positioned) inside the
        // scroll box; without it, it escapes and makes the whole page scroll sideways on a phone.
        <div className="relative overflow-x-auto rounded-2xl border border-border bg-white">
          <table className="w-full text-sm">
            <caption className="sr-only">Discount codes</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-secondary">
                <th scope="col" className="px-4 py-3 font-semibold">Code</th>
                <th scope="col" className="px-4 py-3 font-semibold">Discount</th>
                <th scope="col" className="px-4 py-3 font-semibold">Minimum spend</th>
                <th scope="col" className="px-4 py-3 font-semibold">Used</th>
                <th scope="col" className="px-4 py-3 font-semibold">Last day</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <th scope="row" className="px-4 py-3 text-left font-bold">{c.code}</th>
                  <td className="px-4 py-3">{c.type === 'percentage' ? `${c.value}% off` : `${formatMoney(c.value, currency)} off`}</td>
                  <td className="px-4 py-3 text-text-secondary">{c.minSubtotal ? formatMoney(c.minSubtotal, currency) : 'None'}</td>
                  <td className="px-4 py-3 tabular-nums">{c.usageCount} / {c.usageLimit ?? 'no limit'}</td>
                  <td className="px-4 py-3 text-text-secondary">{c.expiresAt ? formatDate(c.expiresAt) : 'None'}</td>
                  <td className="px-4 py-3"><Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-3 whitespace-nowrap">
                      <button onClick={() => setEditing(c)} className="font-semibold text-brand hover:text-brand-hover" aria-label={`Edit ${c.code}`}>Edit</button>
                      <button onClick={() => void toggle(c)} className="font-semibold text-brand hover:text-brand-hover" aria-label={`${c.active ? 'Switch off' : 'Switch on'} ${c.code}`}>
                        {c.active ? 'Switch off' : 'Switch on'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <MarketingInsights storeId={activeStore.id} />

      {creating && (
        <CreateDialog
          storeId={activeStore.id}
          currency={currency}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            setNotice('Discount code created.')
            void load()
          }}
        />
      )}
      {editing && (
        <EditDialog
          storeId={activeStore.id}
          code={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            setNotice('Discount code updated.')
            void load()
          }}
        />
      )}
    </div>
  )
}
