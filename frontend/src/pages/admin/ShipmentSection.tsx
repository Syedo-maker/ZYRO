import { useState } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { formatDateTime } from '../../lib/format'
import { errorMessage, ordersApi } from '../../lib/ordersApi'
import type { Order, ShipmentStatus } from '../../types/commerce'

const STATUS_LABEL: Record<ShipmentStatus, string> = {
  pending: 'Not shipped yet',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

interface ShipmentSectionProps {
  order: Order
  storeId: string
  onChanged: (order: Order) => void
}

/** Carrier, tracking number and the forward-only shipped, delivered steps for an online order. */
export function ShipmentSection({ order, storeId, onChanged }: ShipmentSectionProps) {
  const shipment = order.shipment
  const [carrier, setCarrier] = useState(shipment?.carrier ?? '')
  const [tracking, setTracking] = useState(shipment?.trackingNumber ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const status: ShipmentStatus | null = shipment?.status ?? null
  const canEdit = status === null || status === 'pending' || status === 'shipped'
  const canShip = status === null || status === 'pending'
  const canDeliver = status === 'shipped'

  async function save(next?: ShipmentStatus) {
    setBusy(true)
    setError(null)
    try {
      const updated = await ordersApi.updateShipment(storeId, order.id, {
        carrier: carrier.trim() || undefined,
        trackingNumber: tracking.trim() || undefined,
        ...(next ? { status: next } : {}),
      })
      onChanged(updated)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="shipment-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 id="shipment-heading" className="text-xs font-semibold text-text-secondary">Shipment</h3>
        <span className="text-xs font-semibold">{status ? STATUS_LABEL[status] : 'Not shipped yet'}</span>
      </div>
      {shipment?.shippedAt && <p className="text-xs text-text-muted">Shipped {formatDateTime(shipment.shippedAt)}</p>}
      {shipment?.deliveredAt && <p className="text-xs text-text-muted">Delivered {formatDateTime(shipment.deliveredAt)}</p>}
      {error && <Alert>{error}</Alert>}

      {canEdit ? (
        <>
          <Input id="ship-carrier" label="Carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} maxLength={100} />
          <Input id="ship-tracking" label="Tracking number" value={tracking} onChange={(e) => setTracking(e.target.value)} maxLength={100} />
          <div className="flex flex-wrap gap-2">
            {canShip && <Button className="h-10 flex-1" disabled={busy} onClick={() => void save('shipped')}>Mark shipped</Button>}
            {canDeliver && <Button className="h-10 flex-1" disabled={busy} onClick={() => void save('delivered')}>Mark delivered</Button>}
            <Button variant="secondary" className="h-10 flex-1" disabled={busy || (!carrier.trim() && !tracking.trim())} onClick={() => void save()}>
              Save details
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-text-secondary">
          {shipment?.carrier ?? 'No carrier'}
          {shipment?.trackingNumber ? `, tracking ${shipment.trackingNumber}` : ''}
        </p>
      )}
    </section>
  )
}
