import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../../context/AuthContext'
import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import { formatDate, formatMoney } from '../../lib/format'
import { errorMessage } from '../../lib/ordersApi'
import { paymentsApi, type PaymentProof, type PendingCodOrder, type RemittanceRun } from '../../lib/paymentsApi'

const BAND_TONE = { low: 'success', medium: 'warning', high: 'danger' } as const
const BAND_LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' } as const

const ITEM_LABEL: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  matched: { label: 'Matched', tone: 'success' },
  amount_mismatch: { label: 'Wrong amount', tone: 'danger' },
  unknown_order: { label: 'Unknown order', tone: 'warning' },
  duplicate_in_file: { label: 'Listed twice', tone: 'warning' },
  not_cod: { label: 'Not cash on delivery', tone: 'warning' },
}

/** One cash-on-delivery order waiting for the courier's money, with the reasons behind its score. */
function CodRow({ order, onDone }: { order: PendingCodOrder; onDone: (text: string) => void }) {
  const { activeStore } = useAuth()
  const [busy, setBusy] = useState<string | null>(null)
  const [showWhy, setShowWhy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function record(outcome: 'collected' | 'refused') {
    if (!activeStore) return
    setBusy(outcome)
    setError(null)
    try {
      await paymentsApi.recordCodOutcome(activeStore.id, order.orderId, outcome === 'collected' ? { outcome, amount: order.total } : { outcome })
      onDone(outcome === 'collected' ? `Order #${order.orderNumber} is marked paid.` : `Order #${order.orderNumber} is cancelled and the items are back in stock.`)
    } catch (e) {
      setError(errorMessage(e, 'Could not record that.'))
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold">#{order.orderNumber}</span>
          <span className="tabular-nums">{formatMoney(order.total, order.currency)}</span>
          <span className="text-sm text-text-secondary">{order.shippingName}</span>
          <span className="text-xs text-text-secondary">{formatDate(order.placedAt)}</span>
          {order.risk && <Badge tone={BAND_TONE[order.risk.band]}>{BAND_LABEL[order.risk.band]}</Badge>}
        </div>
        <div className="flex gap-2">
          <Button className="h-9 px-4 text-xs" disabled={busy !== null} onClick={() => void record('collected')}>
            {busy === 'collected' ? 'Saving...' : 'Cash collected'}
          </Button>
          <Button variant="secondary" className="h-9 px-4 text-xs" disabled={busy !== null} onClick={() => void record('refused')}>
            {busy === 'refused' ? 'Saving...' : 'Parcel refused'}
          </Button>
        </div>
      </div>
      {order.risk && order.risk.reasons.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowWhy(!showWhy)} className="text-xs font-semibold text-brand hover:text-brand-hover">
            {showWhy ? 'Hide why' : 'Why this score?'}
          </button>
          {showWhy && (
            <ul className="mt-2 flex flex-col gap-1">
              {order.risk.reasons.map((r) => (
                <li key={r.code} className="text-xs text-text-secondary">
                  <span className={`font-semibold tabular-nums ${r.points > 0 ? 'text-danger' : 'text-success'}`}>
                    {r.points > 0 ? '+' : ''}
                    {r.points}
                  </span>{' '}
                  {r.detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  )
}

/** One payment screenshot, beside what the AI read from it and the checks the server ran. */
function ProofCard({ proof, onDone }: { proof: PaymentProof; onDone: (text: string) => void }) {
  const { activeStore } = useAuth()
  const [busy, setBusy] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function review(decision: 'accept' | 'reject') {
    if (!activeStore) return
    setBusy(decision)
    setError(null)
    try {
      await paymentsApi.reviewProof(activeStore.id, proof.id, { decision, reason: decision === 'reject' ? reason || undefined : undefined })
      onDone(decision === 'accept' ? `Order #${proof.order?.orderNumber} is marked paid.` : `The screenshot for order #${proof.order?.orderNumber} was rejected.`)
    } catch (e) {
      setError(errorMessage(e, 'Could not save that.'))
      setBusy(null)
    }
  }

  const tone = { ok: 'text-success', warning: 'text-warning', problem: 'text-danger' } as const

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row">
      <a href={proof.imageUrl} target="_blank" rel="noreferrer" className="shrink-0">
        <img src={proof.imageUrl} alt={`Payment screenshot for order ${proof.order?.orderNumber ?? ''}`} className="h-40 w-40 rounded-lg border border-border object-cover" />
      </a>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">#{proof.order?.orderNumber}</span>
          {proof.order && <span className="tabular-nums">{formatMoney(proof.order.total, proof.order.currency)}</span>}
          {proof.needsAttention ? <Badge tone="danger">Needs a look</Badge> : <Badge tone="success">Everything matches</Badge>}
        </div>
        <p className="text-sm text-text-secondary">
          The shopper says they sent {formatMoney(proof.declaredAmount, proof.order?.currency ?? 'PKR')}
          {proof.declaredReference ? `, reference ${proof.declaredReference}` : ''}.
        </p>
        <ul className="flex flex-col gap-1">
          {proof.findings.map((f, i) => (
            <li key={`${f.code}-${i}`} className={`text-xs ${tone[f.severity]}`}>
              {f.severity === 'ok' ? '✓' : f.severity === 'warning' ? '!' : '✗'} {f.detail}
            </li>
          ))}
        </ul>
        {proof.extracted && (
          <p className="text-xs text-text-muted">
            Read from the image: {proof.extracted.amount ?? 'no amount'} {proof.extracted.currency ?? ''}
            {proof.extracted.date ? `, dated ${proof.extracted.date}` : ''}
            {proof.extracted.bank ? `, ${proof.extracted.bank}` : ''}. You decide: the check is a help, not a verdict.
          </p>
        )}
        {proof.status === 'pending' ? (
          <div className="flex flex-wrap items-end gap-2">
            <Button className="h-9 px-4 text-xs" disabled={busy !== null} onClick={() => void review('accept')}>
              {busy === 'accept' ? 'Saving...' : 'Accept payment'}
            </Button>
            <Input id={`reason-${proof.id}`} label="Reason if rejecting" className="h-9 text-xs" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            <Button variant="secondary" className="h-9 px-4 text-xs" disabled={busy !== null} onClick={() => void review('reject')}>
              {busy === 'reject' ? 'Saving...' : 'Reject'}
            </Button>
          </div>
        ) : (
          <Badge tone={proof.status === 'accepted' ? 'success' : 'neutral'}>{proof.status === 'accepted' ? 'Accepted' : 'Rejected'}</Badge>
        )}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </div>
  )
}

/**
 * Payments (Part E): the cash-on-delivery queue, the bank-transfer screenshots waiting to be checked,
 * and reconciling a courier's cash file. For the owner and staff who can work on orders.
 */
export function PaymentsPage() {
  const { activeStore } = useAuth()
  const storeId = activeStore?.id
  const [cod, setCod] = useState<PendingCodOrder[] | null>(null)
  const [proofs, setProofs] = useState<PaymentProof[] | null>(null)
  const [runs, setRuns] = useState<RemittanceRun[]>([])
  const [openRun, setOpenRun] = useState<RemittanceRun | null>(null)
  const [courier, setCourier] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!storeId) return
    const [c, p, r] = await Promise.all([paymentsApi.pendingCod(storeId), paymentsApi.proofs(storeId, 'pending'), paymentsApi.remittances(storeId)])
    setCod(c)
    setProofs(p)
    setRuns(r)
  }, [storeId])

  useEffect(() => {
    load().catch((e) => setNotice({ tone: 'error', text: errorMessage(e, 'Could not load your payments.') }))
  }, [load])

  async function done(text: string) {
    setNotice({ tone: 'success', text })
    await load().catch(() => undefined)
  }

  async function importFile(e: FormEvent) {
    e.preventDefault()
    if (!storeId || !file) return
    setBusy('import')
    setNotice(null)
    try {
      const run = await paymentsApi.importRemittance(storeId, { courier, csv: await file.text(), fileName: file.name })
      setOpenRun(run)
      setNotice({ tone: 'success', text: `${run.matchedCount} of ${run.rowCount} lines matched your orders. ${run.problemCount} need a look.` })
      setFile(null)
      ;(e.target as HTMLFormElement).reset()
      await load()
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err, 'Could not read that file.') })
    } finally {
      setBusy(null)
    }
  }

  if (!activeStore) return <p className="text-sm text-text-secondary">Create a store first.</p>
  if (!cod || !proofs) return notice?.tone === 'error' ? <Alert>{notice.text}</Alert> : <Spinner label="Loading payments" />

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Payments</h1>
        <p className="mt-1 text-sm text-text-secondary">Cash on delivery, bank transfers and courier cash, for {activeStore.name}.</p>
      </div>

      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <section aria-label="Cash on delivery" className="rounded-2xl border border-border bg-white p-5">
        <h2 className="font-display text-base font-bold">Waiting for cash on delivery</h2>
        <p className="mt-1 text-sm text-text-secondary">Orders sent out unpaid. Mark each one once the courier hands the money over, or if the parcel came back.</p>
        {cod.length === 0 ? (
          <p className="mt-4 text-sm text-text-secondary">Nothing is waiting.</p>
        ) : (
          <div className="mt-2">
            {cod.map((o) => (
              <CodRow key={o.orderId} order={o} onDone={done} />
            ))}
          </div>
        )}
      </section>

      <section aria-label="Payment screenshots" className="rounded-2xl border border-border bg-white p-5">
        <h2 className="font-display text-base font-bold">Payment screenshots to check</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Shoppers who transferred the money themselves. The checks below are there to help you look; accepting a payment is always your decision.
        </p>
        {proofs.length === 0 ? (
          <p className="mt-4 text-sm text-text-secondary">Nothing is waiting.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {proofs.map((p) => (
              <ProofCard key={p.id} proof={p} onDone={done} />
            ))}
          </div>
        )}
      </section>

      <section aria-label="Courier cash" className="rounded-2xl border border-border bg-white p-5">
        <h2 className="font-display text-base font-bold">Courier cash</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Import the file your courier sends with its cash. It is checked against your own orders and reports what does not line up; no order is marked paid by importing a file.
        </p>

        <form onSubmit={importFile} aria-label="Import a courier file" className="mt-4 flex flex-wrap items-end gap-3">
          <Input id="courier" label="Courier" required maxLength={60} value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="TCS" />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="remittance-file" className="text-xs font-semibold text-text-secondary">
              CSV file
            </label>
            <input id="remittance-file" type="file" accept=".csv,text/csv" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
          </div>
          <Button type="submit" className="h-10" disabled={busy !== null || !file || !courier.trim()}>
            {busy === 'import' ? 'Checking...' : 'Check against my orders'}
          </Button>
        </form>

        {openRun?.items && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-secondary">
                  <th scope="col" className="py-2 pr-4 font-semibold">In the file</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">Collected</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Result</th>
                  <th scope="col" className="py-2 font-semibold">What to do</th>
                </tr>
              </thead>
              <tbody>
                {openRun.items.map((i, n) => (
                  <tr key={`${i.reference}-${n}`} className="border-t border-border">
                    <td className="py-2.5 pr-4">{i.reference}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{i.amount.toFixed(2)}</td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={ITEM_LABEL[i.status]?.tone ?? 'neutral'}>{ITEM_LABEL[i.status]?.label ?? i.status}</Badge>
                    </td>
                    <td className="py-2.5 text-text-secondary">{i.detail ?? 'Nothing: this one matches.'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {runs.length > 0 && (
          <ul className="mt-4 flex flex-col gap-1 text-sm">
            {runs.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="text-left text-text-secondary hover:text-text"
                  onClick={() => void paymentsApi.remittance(activeStore.id, r.id).then(setOpenRun)}
                >
                  <span className="font-semibold text-text">{r.courier}</span> {r.fileName ? `(${r.fileName})` : ''}: {r.matchedCount} of {r.rowCount} matched, {formatDate(r.createdAt)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
