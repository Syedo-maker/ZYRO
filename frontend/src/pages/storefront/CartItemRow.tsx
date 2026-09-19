import { formatMoney } from '../../lib/format'
import type { CartItem } from '../../types/commerce'

interface CartItemRowProps {
  item: CartItem
  currency: string
  busy: boolean
  onSetQuantity: (quantity: number) => void
  onRemove: () => void
}

export function CartItemRow({ item, currency, busy, onSetQuantity, onRemove }: CartItemRowProps) {
  const overStock = item.quantity > item.availableStock

  return (
    <li className="flex gap-3 rounded-[14px] border border-border bg-white p-3 sm:gap-4 sm:p-4">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-[10px] bg-bg sm:h-[84px] sm:w-[84px]">
        {item.imageUrl && <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h2 className="text-sm font-semibold">{item.title}</h2>
        <p className="text-xs text-text-muted">{formatMoney(item.unitPrice, currency)} each</p>
        {overStock && (
          <p role="alert" className="text-xs font-semibold text-danger">
            {item.availableStock === 0
              ? 'Out of stock. Remove it to continue.'
              : `Only ${item.availableStock} left. Lower the quantity to continue.`}
          </p>
        )}

        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex h-8 items-center rounded-lg border border-border" role="group" aria-label={`Quantity of ${item.title}`}>
            <button
              type="button"
              aria-label={`Decrease quantity of ${item.title}`}
              disabled={busy || item.quantity <= 1}
              onClick={() => onSetQuantity(item.quantity - 1)}
              className="h-full w-8 text-sm disabled:opacity-40"
            >
              −
            </button>
            <span className="flex h-full w-8 items-center justify-center border-x border-border text-[13px] font-semibold" aria-live="polite">
              {item.quantity}
            </span>
            <button
              type="button"
              aria-label={`Increase quantity of ${item.title}`}
              disabled={busy || item.quantity >= item.availableStock}
              onClick={() => onSetQuantity(item.quantity + 1)}
              className="h-full w-8 text-sm disabled:opacity-40"
            >
              +
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[15px] font-bold">{formatMoney(item.lineTotal, currency)}</span>
            <button
              type="button"
              aria-label={`Remove ${item.title} from cart`}
              disabled={busy}
              onClick={onRemove}
              className="text-text-muted hover:text-danger disabled:opacity-40"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </li>
  )
}
