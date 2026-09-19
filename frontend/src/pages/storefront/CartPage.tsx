import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useCart } from '../../context/CartContext'
import { useStore } from '../../context/StoreContext'
import { Alert } from '../../components/ui/Alert'
import { Spinner } from '../../components/ui/Spinner'
import { formatMoney } from '../../lib/format'
import { errorMessage } from '../../lib/ordersApi'
import { CartItemRow } from './CartItemRow'

export function CartPage() {
  const store = useStore()
  const { cart, isLoading, setQuantity, remove } = useCart()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (isLoading) return <Spinner label="Loading your cart" />

  if (!cart || cart.items.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-white px-6 py-16 text-center">
        <h1 className="font-display text-xl font-bold">Your cart is empty</h1>
        <p className="mt-2 text-sm text-text-secondary">Add something you like and it will show up here.</p>
        <Link
          to={`/store/${store.id}`}
          className="mt-6 inline-flex h-11 items-center rounded-[10px] bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-hover"
        >
          Continue shopping
        </Link>
      </div>
    )
  }

  const hasStockProblem = cart.items.some((i) => i.quantity > i.availableStock)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold">Your cart</h1>
      {error && <Alert>{error}</Alert>}

      <div className="flex flex-col items-start gap-8 lg:flex-row">
        <ul className="flex w-full flex-1 flex-col gap-4">
          {cart.items.map((item) => (
            <CartItemRow
              key={item.id}
              item={item}
              currency={cart.currency}
              busy={busy}
              onSetQuantity={(q) => void run(() => setQuantity(item.productId, q))}
              onRemove={() => void run(() => remove(item.productId))}
            />
          ))}
        </ul>

        <aside className="flex w-full flex-col gap-4 rounded-[14px] border border-border bg-white p-6 lg:w-80" aria-label="Order summary">
          <h2 className="text-[15px] font-bold">Order summary</h2>

          <div className="flex gap-2">
            <input
              type="text"
              disabled
              aria-label="Discount code"
              placeholder="Discount code"
              className="min-w-0 flex-1 rounded-[10px] bg-bg px-3.5 py-2.5 text-[13px] disabled:cursor-not-allowed"
            />
            <button type="button" disabled className="rounded-[10px] border border-border px-4 text-sm font-semibold opacity-50">
              Apply
            </button>
          </div>
          <p className="-mt-2 text-xs text-text-muted">Discount codes are coming soon.</p>

          <div className="h-px bg-border" />
          <div className="flex justify-between text-[13px] text-text-secondary">
            <span>Subtotal</span>
            <span className="font-semibold text-text">{formatMoney(cart.subtotal, cart.currency)}</span>
          </div>
          <p className="text-xs text-text-muted">Shipping and tax are calculated at checkout.</p>

          {hasStockProblem ? (
            <p className="text-xs font-semibold text-danger">Fix the items marked above to continue.</p>
          ) : (
            <Link
              to={`/store/${store.id}/checkout`}
              className="inline-flex h-12 items-center justify-center rounded-[10px] bg-brand text-sm font-semibold text-white hover:bg-brand-hover"
            >
              Proceed to checkout
            </Link>
          )}
          <Link to={`/store/${store.id}`} className="text-center text-[13px] font-semibold text-brand hover:text-brand-hover">
            Continue shopping
          </Link>
        </aside>
      </div>
    </div>
  )
}
