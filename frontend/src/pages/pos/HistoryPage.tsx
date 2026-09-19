import { useCallback, useEffect, useState } from 'react'
import { usePos } from '../../context/PosContext'
import { OrderStatusBadge } from '../../components/OrderStatusBadge'
import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Spinner } from '../../components/ui/Spinner'
import { errorMessage } from '../../lib/ordersApi'
import { formatDateTime, formatMoney } from '../../lib/format'
import { posApi } from '../../lib/posApi'
import type { Sale, SaleSummary } from '../../types/pos'
import { Receipt, ReceiptPrintCopy } from './Receipt'
import { ReturnDialog } from './ReturnDialog'

const PAGE = 20

const partlyReturned = (s: SaleSummary) => s.status === 'completed' && s.items.some((i) => i.returnedQuantity > 0)
const canReturn = (s: SaleSummary) => s.status === 'completed' && s.items.some((i) => i.returnedQuantity < i.quantity)

export function HistoryPage() {
  const { storeId, session } = usePos()
  const money = (n: number) => formatMoney(n, session.store.currency)
  const [q, setQ] = useState('')
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<{ rows: SaleSummary[]; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Sale | null>(null)
  const [opening, setOpening] = useState<string | null>(null)

  const load = useCallback(() => {
    return posApi
      .listSales(storeId, { q: q.trim() || undefined, limit: PAGE, offset })
      .then((r) => {
        setData({ rows: r.data, total: r.pagination.total })
        setError(null)
      })
      .catch((err: unknown) => setError(errorMessage(err)))
  }, [storeId, q, offset])

  useEffect(() => {
    const timer = setTimeout(() => void load(), q ? 250 : 0)
    return () => clearTimeout(timer)
  }, [load, q])

  // The list holds order summaries; a receipt needs the store, cashier and change, so the full
  // sale is fetched when one is opened.
  async function open(id: string) {
    setOpening(id)
    setError(null)
    try {
      setSelected(await posApi.getSale(storeId, id))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setOpening(null)
    }
  }

  function onSaleChanged(updated: Sale) {
    setSelected(updated)
    setData((cur) => (cur ? { ...cur, rows: cur.rows.map((r) => (r.id === updated.id ? updated : r)) } : cur))
  }

  return (
    <div className="max-w-6xl mx-auto p-6 flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-xl font-bold">Sales history</h1>
        <div className="flex flex-col gap-1.5 w-full sm:w-80">
          <label htmlFor="sales-search" className="text-xs font-semibold text-text-secondary">
            Find a sale by number, customer name or email
          </label>
          <input
            id="sales-search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setOffset(0)
            }}
            className="h-11 rounded-[10px] border border-border bg-white px-3.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {!data && !error ? (
        <Spinner label="Loading sales" />
      ) : data && data.rows.length === 0 ? (
        <p className="text-sm text-text-secondary">No sales found.</p>
      ) : (
        data && (
          <div className="relative bg-white border border-border rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-secondary border-b border-border">
                  <th scope="col" className="px-4 py-3 font-semibold">Sale</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Date</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Customer</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Paid with</th>
                  <th scope="col" className="px-4 py-3 font-semibold text-right">Total</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-semibold">#{s.orderNumber}</td>
                    <td className="px-4 py-3 text-text-secondary">{formatDateTime(s.createdAt)}</td>
                    <td className="px-4 py-3">{s.customer?.name ?? s.customer?.email ?? 'Walk-in'}</td>
                    <td className="px-4 py-3 capitalize">{[...new Set(s.payments.map((p) => p.method))].join(', ')}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(s.total)}</td>
                    <td className="px-4 py-3">
                      {partlyReturned(s) ? <Badge tone="warning">Part returned</Badge> : <OrderStatusBadge status={s.status} />}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => void open(s.id)} disabled={opening === s.id} className="font-semibold text-brand hover:text-brand-hover" aria-label={`Open sale ${s.orderNumber}`}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {data && data.total > PAGE && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-secondary">
            {offset + 1}-{Math.min(offset + PAGE, data.total)} of {data.total}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" className="h-10" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              Previous
            </Button>
            <Button variant="secondary" className="h-10" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {selected && <SaleDialog sale={selected} onClose={() => setSelected(null)} onChanged={onSaleChanged} />}
    </div>
  )
}

function SaleDialog({ sale, onClose, onChanged }: { sale: Sale; onClose: () => void; onChanged: (s: Sale) => void }) {
  const { session } = usePos()
  const [returning, setReturning] = useState(false)

  return (
    <>
      {/* The return dialog opens on top of this one; closing this one would also close the sale view. */}
      <Dialog open title={`Sale #${sale.orderNumber}`} onClose={onClose} size="lg">
        <div className="flex flex-col gap-4">
          <div className="max-h-[55vh] overflow-y-auto rounded-xl border border-border py-4 px-3">
            <Receipt sale={sale} />
          </div>
          {sale.status === 'refunded' && <Alert tone="info">Every item of this sale has been returned.</Alert>}
          {canReturn(sale) && !session.permissions.refunds && (
            <p className="text-sm text-text-secondary">Returns need a manager: ask someone with refund permission to take items back.</p>
          )}
          <div className="flex gap-3">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => window.print()}>
              Print receipt
            </Button>
            {canReturn(sale) && session.permissions.refunds && (
              <Button className="flex-1" onClick={() => setReturning(true)}>
                Return items
              </Button>
            )}
          </div>
          <ReceiptPrintCopy sale={sale} />
        </div>
      </Dialog>
      {returning && (
        <ReturnDialog
          sale={sale}
          onClose={() => setReturning(false)}
          onReturned={(updated) => {
            setReturning(false)
            onChanged(updated)
          }}
        />
      )}
    </>
  )
}
