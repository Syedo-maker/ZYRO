import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import { formatDate, formatMoney } from '../../lib/format'
import { errorMessage } from '../../lib/ordersApi'
import { planPaymentsApi, priceLabel, type OwnerPlanRequest, type PlanPaymentOverview } from '../../lib/planPaymentsApi'

const STATUS: Record<OwnerPlanRequest['status'], { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  awaiting_proof: { label: 'Waiting for your payment', tone: 'neutral' },
  pending: { label: 'Being reviewed', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  revoked: { label: 'Ended', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

/**
 * Upgrade to Pro by bank or wallet transfer (Pro plan payments, 2026-11). The owner sees the price in
 * their billing currency and the platform's payment details for it, gets a reference code, pays, then
 * uploads the screenshot with the transaction ID. A person reviews it; this page only says so.
 */
export function UpgradeProPage() {
  const { activeStore } = useAuth()
  const storeId = activeStore?.id
  const [data, setData] = useState<PlanPaymentOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [transactionId, setTransactionId] = useState('')

  const load = useCallback(async () => {
    if (!storeId) return
    setData(await planPaymentsApi.overview(storeId))
    setError(null)
  }, [storeId])
  // The first load: state is only set when the answer arrives, and not after leaving the page.
  useEffect(() => {
    if (!storeId) return
    let cancelled = false
    planPaymentsApi.overview(storeId).then(
      (d) => !cancelled && setData(d),
      (err) => !cancelled && setError(errorMessage(err)),
    )
    return () => {
      cancelled = true
    }
  }, [storeId])

  async function act(name: string, fn: () => Promise<unknown>) {
    setBusy(name)
    setError(null)
    try {
      await fn()
      await load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault()
    if (!storeId || !data?.openRequest || !file) return
    const requestId = data.openRequest.id
    await act('send', async () => {
      const { key } = await planPaymentsApi.uploadProof(storeId, requestId, file)
      await planPaymentsApi.submit(storeId, requestId, key, transactionId)
      setFile(null)
      setTransactionId('')
    })
  }

  if (!activeStore) return <p className="text-sm text-text-secondary">Create a store first.</p>
  if (activeStore.role !== 'owner') return <Alert tone="info">Only the store owner can upgrade the plan.</Alert>
  if (!data) return error ? <Alert>{error}</Alert> : <Spinner label="Loading the upgrade page" />

  const open = data.openRequest
  const onPro = data.currentPlan.tier !== 'FREE'
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Upgrade to Pro</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {activeStore.name} · <Link to="/admin/billing" className="underline underline-offset-4">See what each plan includes</Link>
        </p>
      </div>

      {error && <Alert>{error}</Alert>}
      {!data.configured && <Alert tone="info">Paying for a plan by transfer is not set up on this server yet.</Alert>}

      {onPro && (
        <section aria-label="Your plan" className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-lg font-bold">{data.currentPlan.tier === 'PRO' ? 'Pro' : 'Business'} plan</h2>
            <Badge tone={data.currentPlan.provisional ? 'warning' : 'success'}>{data.currentPlan.provisional ? 'Provisional' : 'Active'}</Badge>
          </div>
          {data.currentPlan.until && (
            <p className="mt-2 text-sm text-text-secondary">
              {data.currentPlan.provisional
                ? `Provisional until ${formatDate(data.currentPlan.until)}, while a person confirms your payment. AI limits are lower until then.`
                : `Paid until ${formatDate(data.currentPlan.until)}. Renew any time: the days you have left are kept.`}
            </p>
          )}
        </section>
      )}

      {data.configured && data.price && (
        <section aria-label="Price and payment details" className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-display text-lg font-bold">Pro, 30 days</h2>
            <p className="font-display text-2xl font-bold" aria-label="Price">
              {priceLabel(data.price.amountMinor, data.price.currency, formatMoney)}
            </p>
          </div>

          {!data.currency.locked && data.currency.choices.length > 1 && (
            <label className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
              Pay in
              <select
                aria-label="Billing currency"
                value={data.currency.currency ?? ''}
                disabled={busy !== null || open?.status === 'pending'}
                onChange={(e) => void act('currency', () => planPaymentsApi.chooseCurrency(activeStore.id, e.target.value))}
                className="h-9 rounded-control border border-border bg-bg px-2 text-sm text-text"
              >
                {data.currency.choices.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <span className="text-xs">This is fixed after your first payment.</span>
            </label>
          )}

          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">Send the payment to</h3>
            <ul className="grid gap-3 sm:grid-cols-2">
              {data.methods.map((m) => (
                <li key={`${m.label}-${m.accountNumber}`} className="rounded-control border border-border p-3 text-sm">
                  <p className="font-semibold">{m.label}</p>
                  <p className="text-text-secondary">{m.accountTitle}</p>
                  <p className="break-all font-mono">{m.accountNumber}</p>
                  {m.bank && <p className="text-text-secondary">{m.bank}</p>}
                  {m.notes && <p className="mt-1 text-xs text-text-secondary">{m.notes}</p>}
                </li>
              ))}
            </ul>
          </div>

          <Alert tone="info">{data.notice}</Alert>

          {!open && (
            <Button className="self-start" disabled={busy !== null} onClick={() => void act('start', () => planPaymentsApi.start(activeStore.id))}>
              {busy === 'start' ? 'Preparing...' : onPro ? 'Renew Pro' : 'Get my reference code'}
            </Button>
          )}

          {open?.status === 'awaiting_proof' && (
            <form onSubmit={send} aria-label="Send your payment proof" className="flex flex-col gap-3 rounded-control border border-border p-4">
              <p className="text-sm">
                Your reference code: <strong className="font-mono" aria-label="Reference code">{open.referenceCode}</strong>. Put it in the transfer note, then send{' '}
                {priceLabel(open.amountMinor, open.currency, formatMoney)}.
              </p>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="plan-proof" className="text-xs font-semibold text-text-secondary">
                  Payment screenshot
                </label>
                <input id="plan-proof" type="file" accept="image/jpeg,image/png,image/webp" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-full min-w-0 max-w-full text-sm text-text-secondary file:mr-3 file:h-10 file:cursor-pointer file:rounded-full file:border file:border-text/25 file:bg-transparent file:px-4 file:text-sm file:font-semibold file:text-text hover:file:border-text/60" />
                <p className="text-xs text-text-secondary">JPEG, PNG or WebP, up to 5 MB. Only the platform's approvers can see it.</p>
              </div>
              <Input id="plan-transaction-id" label="Transaction ID (from your receipt)" maxLength={100} required value={transactionId} onChange={(e) => setTransactionId(e.target.value)} />
              <Button type="submit" className="self-start" disabled={busy !== null || !file || !transactionId.trim()}>
                {busy === 'send' ? 'Sending...' : 'Send for review'}
              </Button>
            </form>
          )}

          {open?.status === 'pending' && (
            <div role="status" className="rounded-control border border-border p-4 text-sm">
              <p className="font-semibold">Your payment is being reviewed.</p>
              <p className="mt-1 text-text-secondary">
                Reference {open.referenceCode}, sent {open.submittedAt ? formatDate(open.submittedAt) : ''}. We email you when it is decided.
              </p>
            </div>
          )}
        </section>
      )}

      {data.history.length > 0 && (
        <section aria-label="Past payments" className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-3 font-display text-lg font-bold">Past payments</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {data.history.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border pb-2 last:border-0">
                <span className="font-mono">{r.referenceCode}</span>
                <span>{priceLabel(r.amountMinor, r.currency, formatMoney)}</span>
                <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                {r.periodEnd && r.status === 'approved' && <span className="text-text-secondary">until {formatDate(r.periodEnd)}</span>}
                {r.reason && <span className="w-full text-text-secondary">Reason: {r.reason}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
