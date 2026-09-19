import { useState } from 'react'
import { usePos } from '../../context/PosContext'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { errorMessage } from '../../lib/ordersApi'
import { formatMoney } from '../../lib/format'
import { posApi } from '../../lib/posApi'
import type { Sale, TenderMethod } from '../../types/pos'

const cents = (n: number) => Math.round(n * 100)

/**
 * The same split the server uses: the units' price, less their share of the sale's discount,
 * plus their share of its tax. Only an estimate on screen; the server settles the last units
 * to the exact remainder, so the shown figure can differ from the final one by a cent or two.
 */
function estimateRefund(sale: Sale, picks: Map<string, number>): number {
  const subtotal = cents(sale.subtotal)
  const discount = cents(sale.discountAmount)
  const tax = cents(sale.taxAmount)
  const taxBase = subtotal - discount
  let total = 0
  let unitsAfter = 0
  let unitsAll = 0
  for (const item of sale.items) {
    const q = picks.get(item.id) ?? 0
    unitsAll += item.quantity
    unitsAfter += item.returnedQuantity + q
    if (q === 0) continue
    const gross = cents(item.unitPrice) * q
    const share = subtotal > 0 ? Math.round((gross * discount) / subtotal) : 0
    const net = gross - share
    total += net + (taxBase > 0 ? Math.round((net * tax) / taxBase) : 0)
  }
  if (unitsAfter === unitsAll) {
    const already = sale.returns.reduce((s, r) => s + cents(r.amount), 0)
    return cents(sale.total) - already
  }
  return total
}

export function ReturnDialog({ sale, onClose, onReturned }: { sale: Sale; onClose: () => void; onReturned: (sale: Sale) => void }) {
  const { storeId } = usePos()
  const money = (n: number) => formatMoney(n, sale.currency)
  const [picks, setPicks] = useState<Map<string, number>>(new Map())
  const [method, setMethod] = useState<TenderMethod>(() => {
    const first = sale.payments[0]?.method
    return first === 'card' || first === 'other' ? first : 'cash'
  })
  const [reason, setReason] = useState('')
  const [restock, setRestock] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const picked = [...picks.values()].reduce((a, b) => a + b, 0)
  const estimate = picked > 0 ? estimateRefund(sale, picks) / 100 : 0

  function setQty(id: string, max: number, value: number) {
    setPicks((cur) => {
      const next = new Map(cur)
      const q = Math.max(0, Math.min(max, value))
      if (q === 0) next.delete(id)
      else next.set(id, q)
      return next
    })
  }

  async function submit() {
    setError(null)
    setBusy(true)
    try {
      const updated = await posApi.returnItems(storeId, sale.id, {
        items: [...picks].map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
        refundMethod: method,
        reason: reason.trim() || undefined,
        restock,
      })
      onReturned(updated)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open title={`Return items from sale #${sale.orderNumber}`} onClose={() => !busy && onClose()} size="lg">
      <div className="flex flex-col gap-4">
        <ul className="divide-y divide-border border border-border rounded-[10px]">
          {sale.items.map((item) => {
            const left = item.quantity - item.returnedQuantity
            const value = picks.get(item.id) ?? 0
            return (
              <li key={item.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold">{item.productTitleSnapshot}</div>
                  <div className="text-xs text-text-secondary">
                    {money(item.unitPrice)} each, bought {item.quantity}
                    {item.returnedQuantity > 0 ? `, ${item.returnedQuantity} already returned` : ''}
                  </div>
                </div>
                {left === 0 ? (
                  <span className="text-xs font-semibold text-text-secondary">All returned</span>
                ) : (
                  <div className="flex items-center gap-1" role="group" aria-label={`Return quantity of ${item.productTitleSnapshot}`}>
                    <button
                      aria-label={`Return fewer ${item.productTitleSnapshot}`}
                      onClick={() => setQty(item.id, left, value - 1)}
                      className="h-10 w-10 rounded-[10px] border border-border text-lg font-semibold hover:bg-bg"
                    >
                      -
                    </button>
                    <span className="w-14 text-center text-sm font-semibold tabular-nums" aria-live="polite">
                      {value} of {left}
                    </span>
                    <button
                      aria-label={`Return more ${item.productTitleSnapshot}`}
                      onClick={() => setQty(item.id, left, value + 1)}
                      className="h-10 w-10 rounded-[10px] border border-border text-lg font-semibold hover:bg-bg"
                    >
                      +
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-semibold text-text-secondary mb-1">Pay the customer back by</legend>
          <div className="flex gap-2">
            {(['cash', 'card', 'other'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={method === m}
                onClick={() => setMethod(m)}
                className={`flex-1 h-11 rounded-[10px] border text-sm font-semibold capitalize ${
                  method === m ? 'border-brand bg-brand-soft text-brand' : 'border-border hover:bg-bg'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="return-reason" className="text-xs font-semibold text-text-secondary">
            Reason (optional)
          </label>
          <input
            id="return-reason"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-11 rounded-[10px] border border-border px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="h-4 w-4" />
          Put the items back on the shelf (untick if damaged)
        </label>

        <div className="rounded-xl bg-bg px-4 py-3 flex items-baseline justify-between" aria-live="polite">
          <span className="text-sm text-text-secondary">Refund to give</span>
          <span className="font-display text-2xl font-bold tabular-nums">{picked > 0 ? money(estimate) : '-'}</span>
        </div>
        {error && <Alert>{error}</Alert>}

        <div className="flex gap-3">
          <Button variant="secondary" className="h-12" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button className="h-12 flex-1" disabled={picked === 0 || busy} onClick={() => void submit()}>
            {busy ? 'Refunding...' : 'Confirm return'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
