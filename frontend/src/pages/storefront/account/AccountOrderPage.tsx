import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import { useStore } from '../../../context/StoreContext'
import { OrderStatusBadge } from '../../../components/OrderStatusBadge'
import { Alert } from '../../../components/ui/Alert'
import { Badge } from '../../../components/ui/Badge'
import { Spinner } from '../../../components/ui/Spinner'
import { ApiError } from '../../../lib/apiClient'
import { formatDateTime, formatMoney } from '../../../lib/format'
import { errorMessage, ordersApi } from '../../../lib/ordersApi'
import type { Order } from '../../../types/commerce'

const SHIPMENT_LABEL = { pending: 'Preparing your parcel', shipped: 'On its way', delivered: 'Delivered', cancelled: 'Cancelled' } as const

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'text-base font-bold' : 'text-sm text-text-secondary'}`}>
      <span>{label}</span>
      <span className={strong ? '' : 'font-semibold text-text'}>{value}</span>
    </div>
  )
}

/** One of the shopper's orders: what they bought, what they paid, where it is going and where it is now. */
export function AccountOrderPage() {
  const store = useStore()
  const { orderId = '' } = useParams()
  const { isAuthenticated, isLoading } = useAuth()
  const [order, setOrder] = useState<Order | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) return
    ordersApi
      .get(store.id, orderId)
      .then(setOrder)
      .catch((e) => (e instanceof ApiError && e.status === 404 ? setMissing(true) : setError(errorMessage(e))))
  }, [store.id, orderId, isAuthenticated])

  if (isLoading) return null
  if (!isAuthenticated) return <Navigate to={`/store/${store.id}/account/login?next=${encodeURIComponent(`/store/${store.id}/account/orders/${orderId}`)}`} replace />

  const back = (
    <Link to={`/store/${store.id}/account`} className="text-sm font-semibold text-brand hover:text-brand-hover">
      Back to your orders
    </Link>
  )
  if (missing) {
    return (
      <div className="flex flex-col items-start gap-3">
        <h1 className="font-display text-xl font-bold">Order not found</h1>
        <p className="text-sm text-text-secondary">This order does not exist, or it belongs to another account.</p>
        {back}
      </div>
    )
  }
  if (error) return <Alert>{error}</Alert>
  if (!order) return <Spinner label="Loading your order" />

  const money = (n: number) => formatMoney(n, order.currency)
  const refunded = order.refunds.reduce((s, r) => s + r.amount, 0) + (order.returns ?? []).reduce((s, r) => s + r.amount, 0)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {back}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Order #{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-text-secondary">Placed {formatDateTime(order.createdAt)}</p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      {order.shipment && (
        <section aria-labelledby="ship-heading" className="rounded-2xl border border-border bg-white p-5">
          <h2 id="ship-heading" className="text-sm font-bold">
            Delivery
          </h2>
          <p className="mt-2 text-sm">
            <Badge tone={order.shipment.status === 'delivered' ? 'success' : order.shipment.status === 'cancelled' ? 'danger' : 'neutral'}>{SHIPMENT_LABEL[order.shipment.status]}</Badge>
          </p>
          {(order.shipment.carrier || order.shipment.trackingNumber) && (
            <p className="mt-2 text-sm text-text-secondary">
              {order.shipment.carrier}
              {order.shipment.trackingNumber ? ` · Tracking number ${order.shipment.trackingNumber}` : ''}
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="items-heading" className="rounded-2xl border border-border bg-white p-5">
        <h2 id="items-heading" className="text-sm font-bold">
          Items
        </h2>
        <ul className="mt-3 divide-y divide-border">
          {order.items.map((i, idx) => (
            <li key={idx} className="flex items-center justify-between gap-3 py-3 text-sm">
              <span>
                {i.productTitleSnapshot} <span className="text-text-secondary">x {i.quantity}</span>
              </span>
              <span className="font-semibold">{money(i.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-col gap-2 border-t border-border pt-4">
          <Row label="Subtotal" value={money(order.subtotal)} />
          {order.discountAmount > 0 && <Row label={`Discount${order.discountCode ? ` (${order.discountCode})` : ''}`} value={`-${money(order.discountAmount)}`} />}
          <Row label="Shipping" value={money(order.shippingAmount)} />
          <Row label="Tax" value={money(order.taxAmount)} />
          <Row label="Total" value={money(order.total)} strong />
          {refunded > 0 && <Row label="Refunded" value={money(refunded)} />}
        </div>
      </section>

      {order.shippingAddress && (
        <section aria-labelledby="addr-heading" className="rounded-2xl border border-border bg-white p-5">
          <h2 id="addr-heading" className="text-sm font-bold">
            Shipping address
          </h2>
          <address className="mt-2 text-sm not-italic leading-relaxed text-text-secondary">
            {order.shippingName && <>{order.shippingName}<br /></>}
            {order.shippingAddress.line1}
            {order.shippingAddress.line2 && <>, {order.shippingAddress.line2}</>}
            <br />
            {[order.shippingAddress.city, order.shippingAddress.state, order.shippingAddress.postalCode].filter(Boolean).join(', ')}
            {order.shippingAddress.country && <> ({order.shippingAddress.country})</>}
          </address>
        </section>
      )}
    </div>
  )
}
