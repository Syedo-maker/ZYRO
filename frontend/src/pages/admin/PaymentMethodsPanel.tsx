import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { errorMessage } from '../../lib/ordersApi'
import { paymentsApi, type PaymentSettings } from '../../lib/paymentsApi'

const fieldClass = 'h-11 rounded-[10px] border border-border bg-white px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30'

const BLOCK_BANDS = [
  { value: 'none', label: 'Offer it to everyone' },
  { value: 'high', label: 'Not for high-risk orders (recommended)' },
  { value: 'medium', label: 'Not for medium or high-risk orders' },
  { value: 'low', label: 'Effectively off: every order is held back' },
]

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2.5 text-sm font-semibold">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-border text-brand focus:ring-brand/30" />
      {label}
    </label>
  )
}

/**
 * Which ways the store takes money (Part E), on the owner's Settings page: cash on delivery with its
 * limits and how strict the trust check is, and manual bank or wallet transfer with the details a
 * shopper needs. Card payments are always on and are set up separately.
 */
export function PaymentMethodsPanel({ storeId, currency }: { storeId: string; currency: string }) {
  const [settings, setSettings] = useState<PaymentSettings | null>(null)
  const [form, setForm] = useState<PaymentSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    const { settings: s } = await paymentsApi.settings(storeId)
    setSettings(s)
    setForm(s)
  }, [storeId])

  useEffect(() => {
    load().catch((e) => setNotice({ tone: 'error', text: errorMessage(e, 'Could not load your payment methods.') }))
  }, [load])

  const set = <K extends keyof PaymentSettings>(key: K, value: PaymentSettings[K]) => setForm((f) => (f ? { ...f, [key]: value } : f))

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    setSaving(true)
    setNotice(null)
    try {
      const num = (v: string | null) => (v === null || v === '' ? null : Number(v))
      await paymentsApi.updateSettings(storeId, {
        codEnabled: form.codEnabled,
        codMinAmount: num(form.codMinAmount),
        codMaxAmount: num(form.codMaxAmount),
        codBlockBand: form.codBlockBand,
        codAdvancePercent: form.codAdvancePercent,
        bankTransferEnabled: form.bankTransferEnabled,
        bankAccountName: form.bankAccountName,
        bankAccountNumber: form.bankAccountNumber,
        bankName: form.bankName,
        bankInstructions: form.bankInstructions,
      })
      await load()
      setNotice({ tone: 'success', text: 'Saved. Shoppers see these choices at checkout from now on.' })
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not save that.') })
    } finally {
      setSaving(false)
    }
  }

  if (!settings || !form) return null

  return (
    <section aria-label="Payment methods" className="rounded-2xl border border-border bg-white p-5">
      <h2 className="font-display text-base font-bold">Ways to pay</h2>
      <p className="mt-1 text-sm text-text-secondary">Card payments are always on. These are the other ways shoppers can pay you.</p>

      {notice && (
        <div className="mt-3">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}

      <form onSubmit={save} className="mt-4 flex flex-col gap-5">
        <div className="flex flex-col gap-3 rounded-xl bg-bg p-4">
          <Toggle id="cod-enabled" label="Cash on delivery" checked={form.codEnabled} onChange={(v) => set('codEnabled', v)} />
          <p className="text-xs text-text-secondary">
            The shopper pays the courier. The order holds your stock from the moment it is placed, and counts as paid only when you mark the cash collected.
          </p>
          {form.codEnabled && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  id="cod-min"
                  label={`Smallest order (${currency}, blank for none)`}
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.codMinAmount ?? ''}
                  onChange={(e) => set('codMinAmount', e.target.value || null)}
                />
                <Input
                  id="cod-max"
                  label={`Largest order (${currency}, blank for none)`}
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.codMaxAmount ?? ''}
                  onChange={(e) => set('codMaxAmount', e.target.value || null)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cod-band" className="text-xs font-semibold text-text-secondary">
                  When an order looks risky
                </label>
                <select id="cod-band" value={form.codBlockBand} onChange={(e) => set('codBlockBand', e.target.value)} className={fieldClass}>
                  {BLOCK_BANDS.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-text-secondary">
                  Risk is worked out from the order itself and how past cash deliveries to that phone number went, never from the shopper's name or area. You see the reasons on every order.
                </span>
              </div>
              <Input
                id="cod-advance"
                label="Deposit on a risky order (% of the total, 0 for none)"
                type="number"
                min={0}
                max={90}
                value={form.codAdvancePercent}
                onChange={(e) => set('codAdvancePercent', Number(e.target.value))}
              />
            </>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-xl bg-bg p-4">
          <Toggle id="bank-enabled" label="Bank or wallet transfer" checked={form.bankTransferEnabled} onChange={(v) => set('bankTransferEnabled', v)} />
          <p className="text-xs text-text-secondary">
            The shopper sends the money themselves and uploads the receipt. You see what the check found and decide whether to accept it.
          </p>
          {form.bankTransferEnabled && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input id="bank-account-name" label="Account name" maxLength={120} value={form.bankAccountName ?? ''} onChange={(e) => set('bankAccountName', e.target.value || null)} />
              <Input id="bank-account-number" label="Account number or IBAN" maxLength={64} value={form.bankAccountNumber ?? ''} onChange={(e) => set('bankAccountNumber', e.target.value || null)} />
              <Input id="bank-name" label="Bank or wallet" maxLength={120} value={form.bankName ?? ''} onChange={(e) => set('bankName', e.target.value || null)} />
              <Input id="bank-instructions" label="Anything else to tell the shopper" maxLength={1000} value={form.bankInstructions ?? ''} onChange={(e) => set('bankInstructions', e.target.value || null)} />
            </div>
          )}
        </div>

        <div>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save ways to pay'}
          </Button>
        </div>
      </form>
    </section>
  )
}
