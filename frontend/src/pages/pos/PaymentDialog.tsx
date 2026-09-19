import { useRef, useState } from 'react'
import { usePos } from '../../context/PosContext'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { errorMessage } from '../../lib/ordersApi'
import { formatMoney } from '../../lib/format'
import { newRequestId, posApi } from '../../lib/posApi'
import type { PosQuote, Sale, TenderMethod } from '../../types/pos'

interface Row {
  id: number
  method: TenderMethod
  amount: string
  tendered: string
}

const METHODS: { value: TenderMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
]

const cents = (v: string) => Math.round(Number(v) * 100)

/** Notes a customer might hand over for a given amount: exact, then the next round figures. */
function cashShortcuts(amountCents: number): number[] {
  const out = new Set<number>([amountCents])
  for (const step of [500, 1000, 2000, 5000, 10000]) {
    const up = Math.ceil(amountCents / step) * step
    if (up > amountCents) out.add(up)
  }
  return [...out].slice(0, 4)
}

export function PaymentDialog({ quote, onClose, onCompleted }: { quote: PosQuote; onClose: () => void; onCompleted: (sale: Sale) => void }) {
  const { storeId, cart, discount, customer } = usePos()
  const money = (n: number) => formatMoney(n, quote.currency)
  const totalCents = Math.round(quote.total * 100)

  // One id for this dialog: if "Charge" is pressed twice, or the reply is lost and it is
  // pressed again, the server returns the same sale instead of making a second.
  const requestId = useRef(newRequestId())
  const nextRow = useRef(2)
  const [rows, setRows] = useState<Row[]>([{ id: 1, method: 'cash', amount: quote.total.toFixed(2), tendered: '' }])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const paidCents = rows.reduce((s, r) => s + (Number.isFinite(cents(r.amount)) ? cents(r.amount) : 0), 0)
  const dueCents = totalCents - paidCents
  const cashRows = rows.filter((r) => r.method === 'cash')
  const tenderedShort = cashRows.some((r) => r.tendered !== '' && cents(r.tendered) < cents(r.amount))
  const changeCents = cashRows.reduce((s, r) => (r.tendered !== '' && cents(r.tendered) > cents(r.amount) ? s + cents(r.tendered) - cents(r.amount) : s), 0)
  const valid = dueCents === 0 && rows.every((r) => cents(r.amount) > 0) && !tenderedShort

  const update = (id: number, patch: Partial<Row>) => setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  async function charge() {
    setError(null)
    setBusy(true)
    try {
      const sale = await posApi.createSale(storeId, {
        items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        discount,
        customerId: customer?.id,
        payments: rows.map((r) => ({
          method: r.method,
          amount: Number(r.amount),
          ...(r.method === 'cash' && r.tendered !== '' ? { tendered: Number(r.tendered) } : {}),
        })),
        clientRequestId: requestId.current,
      })
      onCompleted(sale)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open title="Payment" onClose={() => !busy && onClose()} size="lg">
      <div className="flex flex-col gap-5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-text-secondary">Total due</span>
          <span className="font-display text-3xl font-bold tabular-nums">{money(quote.total)}</span>
        </div>

        <ul className="flex flex-col gap-4">
          {rows.map((r, index) => (
            <li key={r.id} className="rounded-xl border border-border p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <div role="group" aria-label={`Payment ${index + 1} method`} className="flex gap-2 flex-1">
                  {METHODS.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      aria-pressed={r.method === m.value}
                      onClick={() => update(r.id, { method: m.value, tendered: '' })}
                      className={`flex-1 h-11 rounded-[10px] border text-sm font-semibold ${
                        r.method === m.value ? 'border-brand bg-brand-soft text-brand' : 'border-border hover:bg-bg'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRows((cur) => cur.filter((x) => x.id !== r.id))}
                    className="text-xs font-semibold text-danger"
                    aria-label={`Remove payment ${index + 1}`}
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`amount-${r.id}`} className="text-xs font-semibold text-text-secondary">
                    Amount to pay
                  </label>
                  <input
                    id={`amount-${r.id}`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={r.amount}
                    onChange={(e) => update(r.id, { amount: e.target.value })}
                    className="h-12 rounded-[10px] border border-border px-3.5 text-base tabular-nums outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                  />
                </div>
                {r.method === 'cash' && (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`tendered-${r.id}`} className="text-xs font-semibold text-text-secondary">
                      Cash received
                    </label>
                    <input
                      id={`tendered-${r.id}`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={r.tendered}
                      onChange={(e) => update(r.id, { tendered: e.target.value })}
                      placeholder={r.amount}
                      className="h-12 rounded-[10px] border border-border px-3.5 text-base tabular-nums outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                    />
                  </div>
                )}
              </div>

              {r.method === 'cash' && cents(r.amount) > 0 && (
                <div className="flex flex-wrap gap-2" role="group" aria-label="Cash received shortcuts">
                  {cashShortcuts(cents(r.amount)).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => update(r.id, { tendered: (c / 100).toFixed(2) })}
                      className="rounded-full border border-border px-3 py-1.5 text-sm font-semibold hover:bg-bg tabular-nums"
                    >
                      {c === cents(r.amount) ? 'Exact' : money(c / 100)}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={dueCents <= 0 || rows.length >= 6}
            onClick={() =>
              setRows((cur) => [...cur, { id: nextRow.current++, method: 'card', amount: (dueCents / 100).toFixed(2), tendered: '' }])
            }
            className="font-semibold text-brand disabled:text-text-muted"
          >
            Split payment
          </button>
          <span aria-live="polite" className={dueCents === 0 ? 'font-semibold text-success' : 'font-semibold text-danger'}>
            {dueCents === 0 ? 'Fully paid' : dueCents > 0 ? `${money(dueCents / 100)} still due` : `${money(-dueCents / 100)} too much`}
          </span>
        </div>

        {changeCents > 0 && (
          <div className="rounded-xl bg-success-soft px-4 py-3 flex justify-between items-baseline" aria-live="polite">
            <span className="text-sm font-semibold text-success">Change to give</span>
            <span className="font-display text-2xl font-bold text-success tabular-nums">{money(changeCents / 100)}</span>
          </div>
        )}
        {tenderedShort && <Alert>The cash received is less than the cash payment.</Alert>}
        {error && <Alert>{error}</Alert>}

        <div className="flex gap-3">
          <Button variant="secondary" className="h-14" onClick={onClose} disabled={busy}>
            Back
          </Button>
          <Button className="h-14 flex-1 text-base" onClick={() => void charge()} disabled={!valid || busy}>
            {busy ? 'Recording sale...' : `Complete sale ${money(quote.total)}`}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
