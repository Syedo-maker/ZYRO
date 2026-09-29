import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../../context/AuthContext'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { formatMoney } from '../../lib/format'
import { errorMessage } from '../../lib/ordersApi'
import { storeSettingsApi, type CurrencySetting } from '../../lib/storeSettingsApi'

/**
 * The owner's store settings. For now: the currency the store sells in. It can be changed until the
 * store's first sale; after that the page says why it is fixed, because past orders and reports are
 * in that currency and prices are stored as plain numbers.
 */
export function SettingsPage() {
  const { activeStore } = useAuth()
  const storeId = activeStore?.id
  const isOwner = activeStore?.role === 'owner'
  const [setting, setSetting] = useState<CurrencySetting | null>(null)
  const [choice, setChoice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!storeId) return
    const s = await storeSettingsApi.currency(storeId)
    setSetting(s)
    setChoice(s.currency)
  }, [storeId])

  useEffect(() => {
    if (!isOwner) return
    load().catch((e) => setError(errorMessage(e, 'Could not load your settings.')))
  }, [load, isOwner])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!storeId) return
    setSaving(true)
    setError(null)
    setSaved(null)
    try {
      await storeSettingsApi.setCurrency(storeId, choice)
      await load()
      setSaved(`Prices in your store are now shown in ${setting?.options.find((o) => o.code === choice)?.name ?? choice}.`)
    } catch (err) {
      setError(errorMessage(err, 'Could not change the currency.'))
      await load().catch(() => undefined)
    } finally {
      setSaving(false)
    }
  }

  if (!activeStore) return <p className="text-sm text-text-secondary">Create a store first.</p>
  if (!isOwner) return <Alert tone="info">Only the store owner can change the store's settings.</Alert>
  if (!setting) return error ? <Alert>{error}</Alert> : <Spinner label="Loading your settings" />

  const current = setting.options.find((o) => o.code === setting.currency)

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-text-secondary">{activeStore.name}</p>
      </div>

      {error && <Alert>{error}</Alert>}
      {saved && <Alert tone="success">{saved}</Alert>}

      <section aria-label="Currency" className="rounded-2xl border border-border bg-white p-5">
        <h2 className="font-display text-base font-bold">Currency</h2>
        <p className="mt-1 text-sm text-text-secondary">
          The currency your prices are in, everywhere: your online store, the register, receipts and reports. For example, a product
          priced 450 shows as {formatMoney(450, setting.currency)}.
        </p>

        {setting.locked ? (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-sm">
              Your store sells in <span className="font-semibold">{current ? `${current.name} (${current.code})` : setting.currency}</span>.
            </p>
            <Alert tone="info">{setting.reason}</Alert>
          </div>
        ) : (
          <form onSubmit={save} className="mt-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="store-currency" className="text-xs font-semibold text-text-secondary">
                Currency
              </label>
              <select
                id="store-currency"
                value={choice}
                onChange={(e) => {
                  setChoice(e.target.value)
                  setSaved(null)
                }}
                className="h-11 rounded-[10px] border border-border bg-white px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
              >
                {setting.options.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.name} ({o.code})
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-text-secondary">
              You can change this until your first sale. Prices you have already entered keep their numbers, so check them after
              switching. Plan and billing are always charged in US dollars.
            </p>
            <div>
              <Button type="submit" disabled={saving || choice === setting.currency}>
                {saving ? 'Saving...' : 'Save currency'}
              </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
