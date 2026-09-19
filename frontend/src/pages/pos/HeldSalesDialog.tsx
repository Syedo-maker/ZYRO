import { useEffect, useState } from 'react'
import { usePos } from '../../context/PosContext'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Spinner } from '../../components/ui/Spinner'
import { errorMessage } from '../../lib/ordersApi'
import { formatDateTime } from '../../lib/format'
import { posApi } from '../../lib/posApi'
import type { HeldSale } from '../../types/pos'

/** Carts parked with "Hold". Resuming needs an empty register so nothing is overwritten. */
export function HeldSalesDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { storeId, cart, loadHeld } = usePos()
  const [held, setHeld] = useState<HeldSale[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    posApi.listHeld(storeId).then(setHeld).catch((err: unknown) => setError(errorMessage(err)))
  }, [storeId])

  async function resume(h: HeldSale) {
    setError(null)
    try {
      loadHeld(await posApi.resumeHeld(storeId, h.id))
      onChanged()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function discard(h: HeldSale) {
    setError(null)
    try {
      await posApi.discardHeld(storeId, h.id)
      setHeld((cur) => (cur ?? []).filter((x) => x.id !== h.id))
      onChanged()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Dialog open title="Held sales" onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        {cart.length > 0 && <Alert tone="info">Hold or clear the current sale before resuming another.</Alert>}
        {error && <Alert>{error}</Alert>}
        {held === null && !error ? (
          <Spinner label="Loading held sales" />
        ) : held && held.length === 0 ? (
          <p className="text-sm text-text-secondary">No held sales.</p>
        ) : (
          <ul className="divide-y divide-border border border-border rounded-[10px]">
            {held?.map((h) => (
              <li key={h.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{h.label ?? `${h.itemCount} items`}</div>
                  <div className="text-xs text-text-secondary">
                    {h.items.map((i) => `${i.quantity} x ${i.title}`).join(', ')}
                  </div>
                  <div className="text-xs text-text-secondary">
                    {formatDateTime(h.createdAt)}
                    {h.cashierName ? ` by ${h.cashierName}` : ''}
                  </div>
                </div>
                <Button variant="secondary" className="h-10 px-3" disabled={cart.length > 0} onClick={() => void resume(h)}>
                  Resume
                </Button>
                <Button variant="danger" className="h-10 px-3" onClick={() => void discard(h)} aria-label={`Discard held sale ${h.label ?? ''}`}>
                  Discard
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Dialog>
  )
}
