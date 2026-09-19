import { useState, type FormEvent } from 'react'
import { usePos } from '../../context/PosContext'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { errorMessage } from '../../lib/ordersApi'
import { formatMoney } from '../../lib/format'
import { posApi } from '../../lib/posApi'
import type { PosShift } from '../../types/pos'

/** Shown instead of the register until someone counts the drawer and opens a shift. */
export function OpenShiftCard() {
  const { storeId, session, setShift } = usePos()
  const [float, setFloat] = useState('0')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      setShift(await posApi.openShift(storeId, Number(float)))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-center px-4 py-16">
      <form onSubmit={submit} className="w-full max-w-md bg-white border border-border rounded-2xl p-8 flex flex-col gap-4">
        <h1 className="font-display text-xl font-bold">Open the register</h1>
        <p className="text-sm text-text-secondary">
          Count the cash in the drawer and enter it as the starting float. Sales can be rung up once a shift is open.
        </p>
        <Input
          id="float"
          label={`Starting cash (${session.store.currency})`}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          required
          value={float}
          onChange={(e) => setFloat(e.target.value)}
        />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" disabled={busy} className="h-12">
          {busy ? 'Opening...' : 'Open shift'}
        </Button>
      </form>
    </div>
  )
}

/**
 * Closing counts the drawer without showing what it should hold (a blind count), then
 * reveals the expected cash and the difference.
 */
export function CloseShiftDialog({ onClose }: { onClose: () => void }) {
  const { storeId, session, setShift } = usePos()
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PosShift | null>(null)
  const money = (n: number) => formatMoney(n, session.store.currency)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const closed = await posApi.closeShift(storeId, { countedCash: Number(counted), note: note.trim() || undefined })
      setResult(closed)
      setShift(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open title={result ? 'Shift closed' : 'Close shift'} onClose={onClose} size="lg">
      {result ? (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
            <dt className="text-text-secondary">Starting float</dt>
            <dd className="text-right font-semibold">{money(result.openingFloat)}</dd>
            <dt className="text-text-secondary">Sales in this shift</dt>
            <dd className="text-right font-semibold">
              {result.totals.salesCount} ({money(result.totals.grossSales)})
            </dd>
            <dt className="text-text-secondary">Cash sales</dt>
            <dd className="text-right font-semibold">{money(result.totals.cashSales)}</dd>
            <dt className="text-text-secondary">Cash paid back</dt>
            <dd className="text-right font-semibold">{money(result.totals.cashRefunds)}</dd>
            <dt className="text-text-secondary">Expected in drawer</dt>
            <dd className="text-right font-semibold">{money(result.expectedCash)}</dd>
            <dt className="text-text-secondary">Counted</dt>
            <dd className="text-right font-semibold">{money(result.countedCash ?? 0)}</dd>
          </dl>
          <VarianceLine variance={result.variance ?? 0} money={money} />
          <Button onClick={onClose} className="h-12">
            Done
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">Count all the cash in the drawer and enter the total. The expected amount is shown after you close.</p>
          <Input
            id="counted"
            label={`Cash counted (${session.store.currency})`}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            required
            autoFocus
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
          />
          <Input id="close-note" label="Note (optional)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-3">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={busy || counted === ''}>
              {busy ? 'Closing...' : 'Close shift'}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

export function VarianceLine({ variance, money }: { variance: number; money: (n: number) => string }) {
  if (variance === 0) return <Alert tone="success">The drawer balances exactly.</Alert>
  return variance < 0 ? (
    <Alert>The drawer is short by {money(Math.abs(variance))}.</Alert>
  ) : (
    <Alert tone="info">The drawer is over by {money(variance)}.</Alert>
  )
}
