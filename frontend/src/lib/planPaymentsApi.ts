import { apiFetch } from './apiClient'

/** Pro plan payments by transfer (2026-11): the owner's upgrade page and the approvers' queue. */

export interface PaymentMethodDetails {
  label: string
  accountTitle: string
  accountNumber: string
  bank?: string
  notes?: string
}

export interface OwnerPlanRequest {
  id: string
  referenceCode: string
  status: 'awaiting_proof' | 'pending' | 'approved' | 'rejected' | 'revoked' | 'cancelled'
  amountMinor: number
  currency: string
  submittedAt: string | null
  decidedAt: string | null
  provisionalUntil: string | null
  periodEnd: string | null
  reason?: string | null
}

export interface PlanPaymentOverview {
  configured: boolean
  notice: string
  currentPlan: { tier: 'FREE' | 'PRO' | 'BUSINESS'; until: string | null; provisional: boolean }
  plan: string
  currency: { currency: string | null; locked: boolean; choices: string[] }
  price: { amountMinor: number; currency: string } | null
  methods: PaymentMethodDetails[]
  openRequest: OwnerPlanRequest | null
  history: OwnerPlanRequest[]
}

export interface ProofFinding {
  code: string
  severity: 'ok' | 'warning' | 'problem'
  detail: string
}

export interface AdminPlanRequest {
  id: string
  storeId: string
  storeName: string
  ownerEmail: string
  plan: string
  amountMinor: number
  currency: string
  referenceCode: string
  transactionId: string | null
  status: string
  aiStatus: 'passed' | 'flags' | 'unavailable' | null
  findings: ProofFinding[] | null
  submittedAt: string | null
  provisionalUntil: string | null
  decidedAt: string | null
  decisionReason: string | null
  receivedPkrMinor: number | null
  periodEnd: string | null
}

export interface AdminPlanRequestDetail extends AdminPlanRequest {
  proofUrl: string | null
  audit: { action: string; actorKind: string; createdAt: string }[]
}

export type ReviewLinkState = { state: 'valid' | 'used' | 'expired' | 'decided' | 'unknown' | 'other_approver'; requestId?: string; status?: string }
export interface DecisionResult {
  status: string
  alreadyDecided: boolean
  periodEnd?: string
}

// Paths written out in full, so the contract test (backend/tests/unit/ui-contract.test.ts) can read them.
export const planPaymentsApi = {
  overview: (storeId: string) => apiFetch<PlanPaymentOverview>(`/stores/${storeId}/plan-payments`),
  chooseCurrency: (storeId: string, currency: string) => apiFetch<{ currency: string }>(`/stores/${storeId}/plan-payments/currency`, { method: 'PUT', body: { currency } }),
  start: (storeId: string) => apiFetch<OwnerPlanRequest>(`/stores/${storeId}/plan-payments/requests`, { method: 'POST' }),
  uploadProof: (storeId: string, requestId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiFetch<{ key: string; url: string }>(`/stores/${storeId}/plan-payments/requests/${requestId}/proof-image`, { method: 'POST', body: form })
  },
  submit: (storeId: string, requestId: string, imageKey: string, transactionId: string) =>
    apiFetch<OwnerPlanRequest>(`/stores/${storeId}/plan-payments/requests/${requestId}/submit`, { method: 'POST', body: { imageKey, transactionId } }),
}

export const planRequestsApi = {
  list: (status = 'pending') => apiFetch<{ data: AdminPlanRequest[] }>(`/platform/plan-requests?status=${encodeURIComponent(status)}`),
  get: (id: string) => apiFetch<AdminPlanRequestDetail>(`/platform/plan-requests/${id}`),
  reviewLink: (token: string) => apiFetch<ReviewLinkState>(`/platform/plan-requests/review/${encodeURIComponent(token)}`),
  approve: (id: string, body: { token?: string; receivedPkr?: number }) => apiFetch<DecisionResult>(`/platform/plan-requests/${id}/approve`, { method: 'POST', body }),
  reject: (id: string, body: { reason: string; token?: string }) => apiFetch<DecisionResult>(`/platform/plan-requests/${id}/reject`, { method: 'POST', body }),
  revoke: (id: string, reason: string) => apiFetch<DecisionResult>(`/platform/plan-requests/${id}/revoke`, { method: 'POST', body: { reason } }),
}

/** "Rs 3,000.00 (PKR)": the symbol and the code, so an owner never wonders which currency it is. */
export const priceLabel = (amountMinor: number, currency: string, format: (amount: number, currency: string) => string) => `${format(amountMinor / 100, currency)} (${currency})`
