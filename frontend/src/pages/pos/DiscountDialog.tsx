import { useState, type FormEvent } from 'react'
import { usePos } from '../../context/PosContext'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'

/** A manual discount on the whole sale. The server enforces the cashier's limit; this checks first for a quicker message. */
export function DiscountDialog({ onClose }: { onClose: () => void }) {
  const { session, discount, quote, setDiscount } = usePos()
  const [type, setType] = useState<'percentage' | 'fixed'>(discount?.type ?? 'percentage')
  const [value, setValue] = useState(discount ? String(discount.value) : '')
  const [reason, setReason] = useState(discount?.reason ?? '')
  const [error, setError] = useState<string | null>(null)

  const limit = session.settings.maxCashierDiscountPercent
  const limited = !session.permissions.unlimitedDiscounts

  function submit(e: FormEvent) {
    e.preventDefault()
    const amount = Number(value)
    if (!Number.isFinite(amount) || amount <= 0) return setError('Enter a discount greater than zero.')
    if (type === 'percentage' && amount > 100) return setError('A percentage discount cannot be more than 100.')
    const percent = type === 'percentage' ? amount : quote && quote.subtotal > 0 ? (amount / quote.subtotal) * 100 : 0
    if (limited && percent > limit) {
      return setError(`Cashiers can give up to ${limit}% off. Ask a manager for a bigger discount.`)
    }
    setDiscount({ type, value: amount, reason: reason.trim() || undefined })
    onClose()
  }

  return (
    <Dialog open title="Discount" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <fieldset className="flex gap-2">
          <legend className="sr-only">Discount type</legend>
          {(['percentage', 'fixed'] as const).map((t) => (
            <label
              key={t}
              className={`flex-1 rounded-[10px] border px-3 py-3 text-center text-sm font-semibold cursor-pointer ${
                type === t ? 'border-brand bg-brand-soft text-brand' : 'border-border'
              }`}
            >
              <input type="radio" name="discount-type" value={t} checked={type === t} onChange={() => setType(t)} className="sr-only" />
              {t === 'percentage' ? 'Percent off' : 'Amount off'}
            </label>
          ))}
        </fieldset>
        <Input
          id="discount-value"
          label={type === 'percentage' ? 'Percent' : 'Amount'}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          required
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Input id="discount-reason" label="Reason (optional)" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        {limited && <p className="text-xs text-text-secondary">Your limit is {limit}% of the sale.</p>}
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-3">
          {discount ? (
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setDiscount(null)
                onClose()
              }}
            >
              Remove
            </Button>
          ) : (
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button type="submit" className="flex-1">
            Apply discount
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
