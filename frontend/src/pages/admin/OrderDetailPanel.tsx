import { useState } from 'react'
import { OrderStatusBadge } from '../../components/OrderStatusBadge'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { formatDateTime, formatMoney } from '../../lib/format'
import { errorMessage, ordersApi } from '../../lib/ordersApi'
import type { Order } from '../../types/commerce'
import { RefundDialog } from './RefundDialog'
import { ShipmentSection } from './ShipmentSection'

interface OrderDetailPanelProps {
  order: Order
  storeId: string
  onChanged: (order: Order) => void
  onClose: () => void
}

const METHOD_LABEL: Record<Order['payments'][number]['method'], string> = {
  stripe: 'Stripe',
  card: 'Card',
  cash: 'Cash',
  other: 'Other',
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[13px] text-text-secondary">
      <span>{label}</span>
      <span className="font-semibold text-text">{value}</span>
    </div>
  )
}

export function OrderDetailPanel({ order, storeId, onChanged, onClose }: OrderDetailPanelProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [refundOpen, setRefundOpen] = useState(false)

  const money = (n: number) => formatMoney(n, order.currency)
  const customer = order.customer?.name ?? order.customer?.email ?? order.guestEmail ?? 'Guest'
  const canFulfil = order.status === 'paid'
  const canCancel = order.status === 'paid'
  const canRefund = order.status === 'paid' || order.status === 'fulfilled' || order.status === 'completed'
  const canShip = order.channel === 'online' && (order.status === 'paid' || order.status === 'fulfilled')
  const address = order.shippingAddress

  async function change(status: 'fulfilled' | 'cancelled') {
    setBusy(true)
    setError(null)
    try {
      onChanged(await ordersApi.updateStatus(storeId, order.id, status))
      setCancelOpen(false)
    } catch (e) {
      setError(errorMessage(e))
      setCancelOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside aria-label={`Order ${order.orderNumber} details`} className="flex w-full shrink-0 flex-col gap-4 border-border bg-white p-6 lg:w-[400px] lg:border-l">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-[15px] font-bold">Order #{order.orderNumber}</h2>
        <div className="flex items-center gap-3">
          <OrderStatusBadge status={order.status} />
          <button type="button" onClick={onClose} aria-label="Close order details" className="text-lg leading-none text-text-muted hover:text-text">
            ×
          </button>
        </div>
      </div>
      <p className="text-xs text-text-muted">
        {order.channel === 'pos' ? 'In-store sale' : 'Online order'} placed {formatDateTime(order.createdAt)} by {customer}
      </p>
      {error && <Alert>{error}</Alert>}
      <div className="h-px bg-border" />

      <ul className="flex flex-col gap-3">
        {order.items.map((item, i) => (
          <li key={i} className="flex items-center gap-2.5 text-[13px]">
            <span className="flex-1">{item.productTitleSnapshot} <span className="text-text-muted">× {item.quantity}</span></span>
            <span className="font-semibold">{money(item.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <div className="h-px bg-border" />
      <div className="flex flex-col gap-2">
        <Row label="Subtotal" value={money(order.subtotal)} />
        {order.discountAmount > 0 && <Row label="Discount" value={`−${money(order.discountAmount)}`} />}
        <Row label="Shipping" value={money(order.shippingAmount)} />
        <Row label="Tax" value={money(order.taxAmount)} />
        <div className="flex justify-between text-[15px] font-bold"><span>Total</span><span>{money(order.total)}</span></div>
      </div>

      <div className="text-xs text-text-secondary">
        Paid by {order.payments.map((p) => `${METHOD_LABEL[p.method]} ${money(p.amount)}${p.status === 'refunded' ? ' (refunded)' : ''}`).join(', ')}
      </div>
      {order.refunds.length > 0 && (
        <p className="rounded-[10px] bg-bg px-3 py-2 text-xs text-text-secondary">
          Refunded {formatDateTime(order.refunds[0].createdAt)}
          {order.refunds[0].reason ? `: ${order.refunds[0].reason}` : ''}
          {order.refunds[0].restocked ? '. Items returned to stock.' : '. Items not returned to stock.'}
        </p>
      )}

      {(canFulfil || canCancel || canRefund) && (
        <>
          <div className="h-px bg-border" />
          <div className="flex flex-wrap gap-2">
            {canFulfil && <Button className="h-10 flex-1 whitespace-nowrap px-3" disabled={busy} onClick={() => void change('fulfilled')}>Mark fulfilled</Button>}
            {canCancel && <Button variant="danger" className="h-10 flex-1 whitespace-nowrap px-3" disabled={busy} onClick={() => setCancelOpen(true)}>Cancel order</Button>}
            {canRefund && <Button variant="secondary" className="h-10 flex-1 whitespace-nowrap px-3" disabled={busy} onClick={() => setRefundOpen(true)}>Refund</Button>}
          </div>
        </>
      )}

      {canShip && (
        <>
          <div className="h-px bg-border" />
          <ShipmentSection key={order.id + (order.shipment?.status ?? 'none')} order={order} storeId={storeId} onChanged={onChanged} />
        </>
      )}

      {address && (
        <div className="flex flex-col gap-1 rounded-[10px] bg-bg p-3.5 text-xs text-text-secondary">
          <span className="font-bold text-text">Shipping address</span>
          {order.shippingName && <span>{order.shippingName}</span>}
          <span>{[address.line1, address.line2].filter(Boolean).join(', ')}</span>
          <span>{[address.city, address.state, address.postalCode].filter(Boolean).join(', ')}</span>
          <span>{address.country}</span>
        </div>
      )}

      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} title={`Cancel order #${order.orderNumber}?`}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">
            The customer is refunded {money(order.total)} in full and the items go back in stock. It cannot be undone.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setCancelOpen(false)} disabled={busy}>Keep order</Button>
            <Button variant="danger" className="flex-1" onClick={() => void change('cancelled')} disabled={busy}>
              {busy ? 'Cancelling…' : 'Cancel and refund'}
            </Button>
          </div>
        </div>
      </Dialog>

      {refundOpen && (
        <RefundDialog
          order={order}
          storeId={storeId}
          open
          onClose={() => setRefundOpen(false)}
          onRefunded={(o) => {
            setRefundOpen(false)
            onChanged(o)
          }}
        />
      )}
    </aside>
  )
}
