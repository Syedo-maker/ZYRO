import { useState } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { formatMoney } from '../../lib/format'
import { errorMessage, ordersApi } from '../../lib/ordersApi'
import type { Order } from '../../types/commerce'

interface RefundDialogProps {
  order: Order
  storeId: string
  open: boolean
  onClose: () => void
  onRefunded: (order: Order) => void
}

/** Confirms a full refund. Money moves, so it is a deliberate two-step action. */
export function RefundDialog({ order, storeId, open, onClose, onRefunded }: RefundDialogProps) {
  // Goods that have not left the shop go back on the shelf by default; shipped ones do not.
  const [restock, setRestock] = useState(order.status === 'paid')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      onRefunded(await ordersApi.refund(storeId, order.id, { restock, reason: reason.trim() || undefined }))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Refund order #${order.orderNumber}`}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">
          This returns {formatMoney(order.total, order.currency)} to the customer in full. It cannot be undone.
          {order.payments.some((p) => p.method === 'cash' || p.method === 'card') &&
            ' Cash and card-terminal payments are recorded as returned; hand the money back yourself.'}
        </p>
        {error && <Alert>{error}</Alert>}

        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand" />
          <span>Put the items back in stock</span>
        </label>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="refund-reason" className="text-xs font-semibold text-text-secondary">Reason (optional)</label>
          <textarea
            id="refund-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            className="rounded-[10px] border border-border px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>Keep order</Button>
          <Button variant="danger" className="flex-1" onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Refunding…' : 'Refund order'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
