import { useState, type KeyboardEvent } from 'react'
import { productsApi } from '../../lib/productsApi'
import { errorMessage } from '../../lib/ordersApi'

const stepButton =
  'h-9 w-9 shrink-0 border border-border-input bg-surface text-base font-semibold hover:bg-bg disabled:opacity-40 focus-visible:relative focus-visible:z-10'

/**
 * A stock count with minus and plus buttons and the number in between, typed or stepped. Used in the
 * product form (saved with the form) and, through QuickStock, on each row of the products list.
 */
export function StockStepper({
  id,
  label,
  value,
  onChange,
  onKeyDown,
  disabled,
  srOnlyLabel = false,
}: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  disabled?: boolean
  srOnlyLabel?: boolean
}) {
  const n = Number(value)
  const valid = value.trim() !== '' && Number.isInteger(n) && n >= 0
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={srOnlyLabel ? 'sr-only' : 'text-xs font-semibold text-text-secondary'}>
        {label}
      </label>
      <div className="flex items-center">
        <button
          type="button"
          aria-label={`One less (${label})`}
          disabled={disabled || !valid || n <= 0}
          onClick={() => onChange(String(n - 1))}
          className={`${stepButton} rounded-l-[10px]`}
        >
          −
        </button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min="0"
          step="1"
          required
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="h-9 w-16 min-w-0 border-y border-border-input bg-surface text-center text-sm tabular-nums outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          aria-label={`One more (${label})`}
          disabled={disabled || !valid}
          onClick={() => onChange(String(n + 1))}
          className={`${stepButton} rounded-r-[10px]`}
        >
          +
        </button>
      </div>
    </div>
  )
}

/**
 * The quick stock control on a products-list row: change the count and save it alone, without
 * opening the product (the supervisor's product-listing change). Enter saves, Escape puts the saved
 * count back. The shop, the cart and the register read stock live, so the new count applies at once.
 */
export function QuickStock({
  storeId,
  productId,
  title,
  stock,
  onSaved,
}: {
  storeId: string
  productId: string
  title: string
  stock: number
  onSaved: (stock: number) => void
}) {
  const [value, setValue] = useState(String(stock))
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  // A count changed elsewhere (a full edit of the product) replaces what is shown here.
  const [shown, setShown] = useState(stock)
  if (stock !== shown) {
    setShown(stock)
    setValue(String(stock))
  }
  const n = Number(value)
  const valid = value.trim() !== '' && Number.isInteger(n) && n >= 0
  const changed = valid && n !== stock

  async function save() {
    if (!changed || saving) return
    setSaving(true)
    setStatus(null)
    try {
      const result = await productsApi.setStock(storeId, productId, n)
      onSaved(result.stock)
      setValue(String(result.stock))
      setStatus({ tone: 'ok', text: 'Saved' })
    } catch (e) {
      setStatus({ tone: 'error', text: errorMessage(e, 'Not saved') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StockStepper
        id={`stock-${productId}`}
        label={`Stock for ${title}`}
        srOnlyLabel
        value={value}
        disabled={saving}
        onChange={(next) => {
          setValue(next)
          setStatus(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void save()
          } else if (e.key === 'Escape') {
            setValue(String(stock))
            setStatus(null)
          }
        }}
      />
      {changed && (
        <button type="button" onClick={() => void save()} disabled={saving} aria-label={`Save stock for ${title}`} className="text-xs font-semibold text-brand">
          {saving ? 'Saving…' : 'Save'}
        </button>
      )}
      <span role="status" className={`text-xs ${status?.tone === 'error' ? 'text-danger' : 'text-success'}`}>
        {status?.text}
      </span>
    </div>
  )
}
