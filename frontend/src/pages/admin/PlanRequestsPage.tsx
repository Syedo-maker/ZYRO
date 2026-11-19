import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import { formatDateTime, formatMoney } from '../../lib/format'
import { errorMessage } from '../../lib/ordersApi'
import { planRequestsApi, priceLabel, type AdminPlanRequest, type AdminPlanRequestDetail, type ReviewLinkState } from '../../lib/planPaymentsApi'

const AI_BADGE: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  passed: { label: 'All checks passed', tone: 'success' },
  flags: { label: 'Needs a close look', tone: 'warning' },
  unavailable: { label: 'Needs manual review', tone: 'neutral' },
}
const aiBadge = (status: string | null) => AI_BADGE[status ?? 'unavailable'] ?? AI_BADGE.unavailable

/** The approval queue (Pro plan payments): pending requests, oldest first. Platform admins only. */
export function PlanRequestsPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState<AdminPlanRequest[] | null>(null)
  const [status, setStatus] = useState('pending')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.platformAdmin) return
    let cancelled = false
    planRequestsApi
      .list(status)
      .then((r) => !cancelled && setRows(r.data))
      .catch((err) => !cancelled && setError(errorMessage(err)))
    return () => {
      cancelled = true
    }
  }, [status, user?.platformAdmin])

  if (!user?.platformAdmin) return <Alert tone="info">Platform administrators only.</Alert>
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Plan payments</h1>
          <p className="mt-1 text-sm text-text-secondary">Owners paying by transfer. Only you decide: the automatic checks only help.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          Show
          <select
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setRows(null)
              setStatus(e.target.value)
            }} className="h-9 rounded-control border border-border bg-bg px-2 text-sm text-text">
            <option value="pending">Waiting for review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="revoked">Revoked</option>
            <option value="all">All waiting</option>
          </select>
        </label>
      </div>
      {error && <Alert>{error}</Alert>}
      {!rows ? (
        <Spinner label="Loading payments" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-secondary">Nothing here.</p>
      ) : (
        <ul aria-label="Plan payment requests" className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
              <div className="min-w-0">
                <p className="font-semibold">{r.storeName}</p>
                <p className="text-sm text-text-secondary">
                  {priceLabel(r.amountMinor, r.currency, formatMoney)} · <span className="font-mono">{r.referenceCode}</span> · {r.submittedAt ? formatDateTime(r.submittedAt) : 'not sent'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={aiBadge(r.aiStatus).tone}>{aiBadge(r.aiStatus).label}</Badge>
                {r.provisionalUntil && <Badge tone="warning">Provisional Pro running</Badge>}
                <Link to={`/admin/platform/plan-requests/${r.id}`} className="text-sm font-semibold underline underline-offset-4">
                  Open
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Where an emailed link leads: it checks the link, then shows the request. Opening it decides nothing. */
export function PlanReviewLinkPage() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [link, setLink] = useState<ReviewLinkState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.platformAdmin || !token) return
    planRequestsApi.reviewLink(token).then(setLink, (err) => setError(errorMessage(err)))
  }, [token, user?.platformAdmin])

  if (!user?.platformAdmin) return <Alert tone="info">Sign in with your own platform admin account to review this payment.</Alert>
  if (error) return <Alert>{error}</Alert>
  if (!token) return <Alert tone="info">This review link is incomplete. Open the request from the approval queue.</Alert>
  if (!link) return <Spinner label="Checking the link" />
  const messages: Record<string, string> = {
    unknown: 'This review link is not valid.',
    other_approver: 'This review link was sent to another approver. Open the request from the approval queue with your own account.',
    used: 'This review link has already been used.',
    expired: 'This review link has expired.',
    decided: `This request has already been decided (${link.status}).`,
  }
  return (
    <div className="flex flex-col gap-4">
      {link.state !== 'valid' && (
        <Alert tone="info">
          {messages[link.state]} <Link to="/admin/platform/plan-requests" className="underline underline-offset-4">Go to the approval queue</Link>
        </Alert>
      )}
      {link.requestId && <PlanRequestDetail id={link.requestId} token={link.state === 'valid' ? token : undefined} />}
    </div>
  )
}

/** One request from the queue. */
export function PlanRequestDetailPage() {
  const { user } = useAuth()
  const { id } = useParams()
  if (!user?.platformAdmin) return <Alert tone="info">Platform administrators only.</Alert>
  return id ? <PlanRequestDetail id={id} /> : null
}

function PlanRequestDetail({ id, token }: { id: string; token?: string }) {
  const [r, setR] = useState<AdminPlanRequestDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [pkr, setPkr] = useState('')

  const load = useCallback(() => planRequestsApi.get(id).then(setR, (err) => setError(errorMessage(err))), [id])
  useEffect(() => {
    void load()
  }, [load])

  async function decide(name: string, fn: () => Promise<{ status: string; alreadyDecided: boolean }>) {
    setBusy(name)
    setError(null)
    try {
      const result = await fn()
      setNotice(result.alreadyDecided ? `Already decided by another approver (${result.status}). Nothing was changed.` : `Done: ${result.status}.`)
      await load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  if (!r) return error ? <Alert>{error}</Alert> : <Spinner label="Loading the request" />
  const findings = r.findings ?? []
  const pending = r.status === 'pending'
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <Link to="/admin/platform/plan-requests" className="text-sm text-text-secondary underline underline-offset-4">
          Approval queue
        </Link>
        <h1 className="mt-1 font-display text-2xl font-bold">{r.storeName}</h1>
        <p className="mt-1 text-sm text-text-secondary">{r.ownerEmail}</p>
      </div>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <section aria-label="Payment" className="grid gap-5 rounded-2xl border border-border bg-surface p-5 md:grid-cols-2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-text-secondary">Plan</dt>
          <dd>{r.plan === 'PRO' ? 'Pro, 30 days' : r.plan}</dd>
          <dt className="text-text-secondary">Amount</dt>
          <dd aria-label="Amount">{priceLabel(r.amountMinor, r.currency, formatMoney)}</dd>
          <dt className="text-text-secondary">Reference</dt>
          <dd className="font-mono">{r.referenceCode}</dd>
          <dt className="text-text-secondary">Transaction ID</dt>
          <dd className="break-all font-mono">{r.transactionId ?? 'none'}</dd>
          <dt className="text-text-secondary">Status</dt>
          <dd>{r.status}</dd>
          {r.provisionalUntil && (
            <>
              <dt className="text-text-secondary">Provisional</dt>
              <dd>until {formatDateTime(r.provisionalUntil)}</dd>
            </>
          )}
          {r.decisionReason && (
            <>
              <dt className="text-text-secondary">Reason</dt>
              <dd>{r.decisionReason}</dd>
            </>
          )}
        </dl>
        <div>
          {r.proofUrl ? (
            <a href={r.proofUrl} target="_blank" rel="noreferrer">
              <img src={r.proofUrl} alt={`Payment proof for ${r.referenceCode}`} className="max-h-96 w-full rounded-control border border-border object-contain" />
            </a>
          ) : (
            <p className="text-sm text-text-secondary">No screenshot.</p>
          )}
        </div>
      </section>

      <section aria-label="Automatic checks" className="rounded-2xl border border-border bg-surface p-5">
        <div className="mb-3 flex items-center gap-3">
          <h2 className="font-display text-lg font-bold">Automatic checks</h2>
          <Badge tone={aiBadge(r.aiStatus).tone}>{aiBadge(r.aiStatus).label}</Badge>
        </div>
        <ul className="flex flex-col gap-1.5 text-sm">
          {findings.map((f) => (
            <li key={f.code} className="flex gap-2">
              <span className={f.severity === 'ok' ? 'text-success' : f.severity === 'warning' ? 'text-warning' : 'text-danger'}>{f.severity === 'ok' ? 'OK' : f.severity === 'warning' ? 'Check' : 'Problem'}</span>
              <span>{f.detail}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-text-secondary">These checks only help you. Confirm in your own account that the money arrived before you approve.</p>
      </section>

      {pending && (
        <section aria-label="Decision" className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
          <h2 className="font-display text-lg font-bold">Decide</h2>
          <Input id="received-pkr" label="Rupees you actually received (optional, for your own records)" type="number" min={0} step="0.01" value={pkr} onChange={(e) => setPkr(e.target.value)} />
          <Button className="self-start" disabled={busy !== null} onClick={() => void decide('approve', () => planRequestsApi.approve(r.id, { token, ...(pkr ? { receivedPkr: Number(pkr) } : {}) }))}>
            {busy === 'approve' ? 'Approving...' : `Approve: ${priceLabel(r.amountMinor, r.currency, formatMoney)} arrived`}
          </Button>
          <Input id="reject-reason" label="Reason, if you reject (the owner sees it)" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="danger" className="self-start" disabled={busy !== null || reason.trim().length < 3} onClick={() => void decide('reject', () => planRequestsApi.reject(r.id, { reason, token }))}>
            {busy === 'reject' ? 'Rejecting...' : 'Reject'}
          </Button>
        </section>
      )}

      {r.status === 'approved' && (
        <section aria-label="Revoke" className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
          <h2 className="font-display text-lg font-bold">Refund or reversal</h2>
          <Input id="revoke-reason" label="Reason for ending this plan" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="danger" className="self-start" disabled={busy !== null || reason.trim().length < 3} onClick={() => void decide('revoke', () => planRequestsApi.revoke(r.id, reason))}>
            {busy === 'revoke' ? 'Ending...' : 'Revoke the plan'}
          </Button>
        </section>
      )}

      <section aria-label="History" className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-3 font-display text-lg font-bold">History</h2>
        <ul className="flex flex-col gap-1 text-sm text-text-secondary">
          {r.audit.map((a, i) => (
            <li key={i}>
              {formatDateTime(a.createdAt)}: {a.action.replace(/_/g, ' ')} ({a.actorKind})
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
