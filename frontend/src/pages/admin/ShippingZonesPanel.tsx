import { useCallback, useEffect, useState } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { formatMoney } from '../../lib/format'
import { errorMessage, shippingZonesApi } from '../../lib/ordersApi'
import type { ShippingZone } from '../../types/commerce'

type Editing = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; zone: ShippingZone }

function ZoneForm({ initial, onSave, onCancel }: { initial?: ShippingZone; onSave: (v: { name: string; region: string; rateAmount: number }) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [region, setRegion] = useState(initial?.region ?? '')
  const [rate, setRate] = useState(initial ? String(initial.rateAmount) : '')
  const [busy, setBusy] = useState(false)
  const rateNumber = Number(rate)
  const valid = name.trim() !== '' && region.trim() !== '' && rate !== '' && Number.isFinite(rateNumber) && rateNumber >= 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await onSave({ name: name.trim(), region: region.trim(), rateAmount: rateNumber })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mb-4 grid grid-cols-1 gap-3 rounded-[10px] bg-bg p-4 sm:grid-cols-[1.5fr_1fr_1fr_auto] sm:items-end">
      <Input id="zone-name" label="Zone name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
      <Input id="zone-region" label="Region" value={region} onChange={(e) => setRegion(e.target.value)} maxLength={100} required />
      <Input id="zone-rate" label="Rate" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} required />
      <div className="flex gap-2">
        <Button type="submit" className="h-11" disabled={!valid || busy}>{initial ? 'Save' : 'Add'}</Button>
        <Button type="button" variant="secondary" className="h-11" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

/** Flat shipping rates shoppers pick from at checkout. */
export function ShippingZonesPanel({ storeId, currency }: { storeId: string; currency: string }) {
  const [zones, setZones] = useState<ShippingZone[] | null>(null)
  const [editing, setEditing] = useState<Editing>({ mode: 'closed' })
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setZones(await shippingZonesApi.list(storeId))
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [storeId])

  useEffect(() => {
    void reload()
  }, [reload])

  async function save(input: { name: string; region: string; rateAmount: number }) {
    setError(null)
    try {
      if (editing.mode === 'edit') await shippingZonesApi.update(storeId, editing.zone.id, input)
      else await shippingZonesApi.create(storeId, input)
      setEditing({ mode: 'closed' })
      await reload()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function remove(zone: ShippingZone) {
    if (!confirm(`Delete the "${zone.name}" shipping zone? Orders already placed are not affected.`)) return
    setError(null)
    try {
      await shippingZonesApi.remove(storeId, zone.id)
      await reload()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <section aria-labelledby="zones-heading" className="rounded-[14px] border border-border bg-white p-5">
      <div className="mb-3.5 flex items-center justify-between">
        <h2 id="zones-heading" className="text-sm font-bold">Shipping zones</h2>
        {editing.mode === 'closed' && (
          <Button variant="secondary" className="h-9 text-[13px]" onClick={() => setEditing({ mode: 'create' })}>+ Add zone</Button>
        )}
      </div>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {editing.mode !== 'closed' && (
        <ZoneForm
          key={editing.mode === 'edit' ? editing.zone.id : 'new'}
          initial={editing.mode === 'edit' ? editing.zone : undefined}
          onSave={save}
          onCancel={() => setEditing({ mode: 'closed' })}
        />
      )}

      {zones === null && <p className="text-sm text-text-secondary">Loading…</p>}
      {zones?.length === 0 && (
        <p className="py-4 text-sm text-text-secondary">
          No shipping zones yet. Shoppers are not charged for shipping until you add one.
        </p>
      )}
      {zones && zones.length > 0 && (
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="text-[11px] font-bold text-text-muted">
              <th scope="col" className="pb-2 font-bold">ZONE</th>
              <th scope="col" className="pb-2 font-bold">REGION</th>
              <th scope="col" className="pb-2 font-bold">RATE</th>
              <th scope="col" className="pb-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.id} className="border-t border-border">
                <td className="py-2">{z.name}</td>
                <td className="py-2">{z.region}</td>
                <td className="py-2 font-semibold">{formatMoney(z.rateAmount, currency)}</td>
                <td className="py-2 text-right">
                  <button type="button" onClick={() => setEditing({ mode: 'edit', zone: z })} className="mr-3 text-xs font-semibold text-brand">Edit</button>
                  <button type="button" onClick={() => void remove(z)} className="text-xs font-semibold text-danger">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
