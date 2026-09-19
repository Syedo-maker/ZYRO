import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useCart } from '../../context/CartContext'
import { useStore } from '../../context/StoreContext'
import { OrderStatusBadge } from '../../components/OrderStatusBadge'
import { Spinner } from '../../components/ui/Spinner'
import { formatMoney } from '../../lib/format'
import { checkoutApi } from '../../lib/storefrontApi'
import type { CheckoutSessionStatus } from '../../types/commerce'

const POLL_MS = 2000
const MAX_POLLS = 30

type View =
  | { kind: 'waiting' }
  | { kind: 'status'; status: CheckoutSessionStatus }
  | { kind: 'timeout' }
  | { kind: 'unknown' }

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-center gap-4 rounded-2xl border border-border bg-white p-8 text-center sm:p-10">
      {children}
    </div>
  )
}

/**
 * Shown after Stripe redirects back. The webhook creates the order, not this redirect, so
 * the order can lag the redirect by a moment: poll until the server reports the outcome.
 */
export function OrderConfirmationPage() {
  const store = useStore()
  const { reload: reloadCart } = useCart()
  const [params] = useSearchParams()
  const sessionId = params.get('session_id')
  const [view, setView] = useState<View>(sessionId ? { kind: 'waiting' } : { kind: 'unknown' })

  // The order consumed the cart on the server; refresh the header's item count to match.
  const completed = view.kind === 'status' && view.status.state === 'completed'
  useEffect(() => {
    if (completed) void reloadCart().catch(() => undefined)
  }, [completed, reloadCart])

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    async function poll(attempt: number) {
      try {
        const status = await checkoutApi.getSessionStatus(store.id, sessionId!)
        if (cancelled) return
        if (status.state !== 'pending') return setView({ kind: 'status', status })
      } catch (e) {
        if (cancelled) return
        if ((e as { status?: number }).status === 404) return setView({ kind: 'unknown' })
      }
      if (attempt >= MAX_POLLS) return setView({ kind: 'timeout' })
      timer = setTimeout(() => void poll(attempt + 1), POLL_MS)
    }

    void poll(1)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [store.id, sessionId])

  const shopLink = (
    <Link to={`/store/${store.id}`} className="text-[13px] font-semibold text-brand hover:text-brand-hover">
      Continue shopping
    </Link>
  )

  if (view.kind === 'waiting') {
    return (
      <Card>
        <Spinner label="Confirming your payment" />
        <p className="text-sm text-text-secondary">This usually takes a few seconds. Please do not close this page.</p>
      </Card>
    )
  }

  if (view.kind === 'timeout') {
    return (
      <Card>
        <h1 className="font-display text-xl font-bold">Still finalizing your order</h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          Your payment was received but the order is taking longer than usual to appear. Bookmark this page and check
          back in a minute; you have not been charged twice.
        </p>
        {shopLink}
      </Card>
    )
  }

  if (view.kind === 'unknown') {
    return (
      <Card>
        <h1 className="font-display text-xl font-bold">We could not find that checkout</h1>
        <p className="text-sm text-text-secondary">The link may be incomplete. If you were charged, contact the store.</p>
        {shopLink}
      </Card>
    )
  }

  const { state, order } = view.status

  if (state === 'completed' && order) {
    return (
      <Card>
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success-soft">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-success" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1 className="font-display text-[22px] font-bold">Order confirmed</h1>
        <p className="text-[13px] leading-relaxed text-text-secondary">
          Thanks{order.shippingName ? `, ${order.shippingName.split(' ')[0]}` : ''}. Your order has been placed.
          {order.email ? ` Stripe will email a receipt to ${order.email}.` : ''}
        </p>

        <dl className="mt-2 flex w-full flex-col gap-2.5 rounded-xl bg-bg p-[18px] text-left text-[13px]">
          <div className="flex justify-between"><dt className="text-text-muted">Order number</dt><dd className="font-bold">#{order.orderNumber}</dd></div>
          <div className="flex justify-between"><dt className="text-text-muted">Total paid</dt><dd className="font-bold">{formatMoney(order.total, order.currency)}</dd></div>
          <div className="flex items-center justify-between"><dt className="text-text-muted">Status</dt><dd><OrderStatusBadge status={order.status} /></dd></div>
        </dl>

        <ul className="w-full divide-y divide-border text-left text-[13px]">
          {order.items.map((i, idx) => (
            <li key={idx} className="flex justify-between py-2">
              <span>{i.title} <span className="text-text-muted">× {i.quantity}</span></span>
              <span className="font-semibold">{formatMoney(i.lineTotal, order.currency)}</span>
            </li>
          ))}
        </ul>
        {shopLink}
      </Card>
    )
  }

  if (state === 'refunded') {
    return (
      <Card>
        <h1 className="font-display text-xl font-bold">Sorry, an item sold out</h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          Someone bought the last unit while you were paying, so your order could not be placed. Your payment has been
          refunded in full; it can take 5 to 10 days to show on your statement. Your cart is still saved, with the
          sold-out item marked so you can adjust it.
        </p>
        <Link to={`/store/${store.id}/cart`} className="text-[13px] font-semibold text-brand hover:text-brand-hover">
          Review your cart
        </Link>
        {shopLink}
      </Card>
    )
  }

  return (
    <Card>
      <h1 className="font-display text-xl font-bold">
        {state === 'expired' ? 'Checkout expired' : 'Payment was not completed'}
      </h1>
      <p className="text-sm text-text-secondary">
        {state === 'expired'
          ? 'You have not been charged, and your cart is still saved.'
          : 'Your cart is still saved. If you see a charge on your statement, contact the store and mention this page.'}
      </p>
      <Link to={`/store/${store.id}/cart`} className="text-[13px] font-semibold text-brand hover:text-brand-hover">
        Back to cart
      </Link>
    </Card>
  )
}
