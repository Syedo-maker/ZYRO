import { useState } from 'react'
import { Link } from 'react-router-dom'
import { buttonStyles } from '../../components/ui/Button'
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
      <div className="rounded-2xl border border-border bg-surface px-6 py-16 text-center">
        <h1 className="font-display text-xl font-bold">Your cart is empty</h1>
        <p className="mt-2 text-sm text-text-secondary">Add something you like and it will show up here.</p>
        <Link
          to={`/store/${store.id}`}
          className={buttonStyles({ className: 'mt-6' })}
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

        <aside className="flex w-full flex-col gap-4 rounded-[14px] border border-border bg-surface p-6 lg:w-80" aria-label="Order summary">
          <h2 className="text-[15px] font-bold">Order summary</h2>

          <div className="h-px bg-border" />
          <div className="flex justify-between text-[13px] text-text-secondary">
            <span>Subtotal</span>
            <span className="font-semibold text-text">{formatMoney(cart.subtotal, cart.currency)}</span>
          </div>
          <p className="text-xs text-text-muted">Shipping, tax and any discount code are handled at checkout.</p>

          {hasStockProblem ? (
            <p className="text-xs font-semibold text-danger">Fix the items marked above to continue.</p>
          ) : (
            <Link
              to={`/store/${store.id}/checkout`}
              className={buttonStyles({ size: 'lg', className: 'text-sm' })}
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
