import { apiFetch } from './apiClient'
import { getGuestSessionId } from './guestSession'

/** Part E: cash on delivery, bank transfer, the trust score and courier reconciliation. */

export interface PaymentSettings {
  codEnabled: boolean
  codMinAmount: string | null
  codMaxAmount: string | null
  codBlockBand: string
  codAdvancePercent: number
  bankTransferEnabled: boolean
  bankAccountName: string | null
  bankAccountNumber: string | null
  bankName: string | null
  bankInstructions: string | null
  gatewayProvider: string | null
  gatewayEnabled: boolean
}

export interface LocalOrderInput {
  method: 'cod' | 'bank_transfer'
  name: string
  phone: string
  email?: string | null
  address: { line1: string; line2?: string | null; city: string; state?: string | null; postalCode?: string | null; country: string }
  shippingZoneId?: string
  discountCode?: string
}

export interface PaymentOptions {
  currency: string
  total: number
  cod: { available: boolean; advanceAmount?: number; note?: string | null }
  bankTransfer: { available: boolean; accountName?: string | null; accountNumber?: string | null; bankName?: string | null; instructions?: string | null }
}

export interface PlacedOrder {
  orderId: string
  orderNumber: number
  total: number
  currency: string
  method: 'cod' | 'bank_transfer'
  payTo?: { accountName: string | null; accountNumber: string | null; bankName: string | null; instructions: string | null }
}

export interface RiskReason {
  code: string
  points: number
  detail: string
}

export interface PendingCodOrder {
  orderId: string
  orderNumber: number
  total: number
  currency: string
  placedAt: string
  shippingName: string | null
  risk: { score: number; band: 'low' | 'medium' | 'high'; reasons: RiskReason[]; outcome: string } | null
}

export interface ProofFinding {
  code: string
  severity: 'ok' | 'warning' | 'problem'
  detail: string
}

export interface PaymentProof {
  id: string
  orderId: string
  imageUrl: string
  declaredAmount: number
  declaredReference: string | null
  extracted: { amount: number | null; currency: string | null; date: string | null; reference: string | null; bank: string | null; sender: string | null; readable: boolean; note: string | null } | null
  findings: ProofFinding[]
  needsAttention: boolean
  summary: string
  status: 'pending' | 'accepted' | 'rejected'
  rejectionReason: string | null
  readBy: string | null
  createdAt: string
  order?: { orderNumber: number; total: number; currency: string }
}

export interface RemittanceItem {
  reference: string
  amount: number
  orderId: string | null
  status: 'matched' | 'amount_mismatch' | 'unknown_order' | 'duplicate_in_file' | 'not_cod'
  detail: string | null
}

export interface RemittanceRun {
  id: string
  courier: string
  fileName: string | null
  rowCount: number
  matchedCount: number
  problemCount: number
  fileTotal: number
  matchedTotal: number
  createdAt: string
  byStatus?: Record<string, number>
  readColumns?: { reference: string; amount: string }
  items?: RemittanceItem[]
}

export interface PaymentHelp {
  reason: string
  nextStep: string
  tryAnotherMethod: boolean
  source: 'known' | 'ai' | 'fallback'
}

const base = (storeId: string) => `/stores/${storeId}/payments`

/**
 * A shopper is usually a guest, so the shopper-facing calls carry the guest session id the cart uses;
 * the API prefers a bearer token when the shopper is logged in. The merchant calls below need neither.
 */
const guest = () => ({ 'X-Guest-Session-Id': getGuestSessionId() })

export const paymentsApi = {
  // Shopper
  options: (storeId: string, body: LocalOrderInput) => apiFetch<PaymentOptions>(`${base(storeId)}/options`, { method: 'POST', body, headers: guest() }),
  placeOrder: (storeId: string, body: LocalOrderInput) => apiFetch<PlacedOrder>(`${base(storeId)}/orders`, { method: 'POST', body, headers: guest() }),
  /** Uploads the screenshot. Open to shoppers, but only for an unpaid bank-transfer order in this store. */
  uploadProofImage: async (storeId: string, orderId: string, file: File): Promise<string> => {
    const form = new FormData()
    form.append('file', file)
    const { url } = await apiFetch<{ url: string }>(`${base(storeId)}/orders/${orderId}/proof-image`, { method: 'POST', body: form })
    return url
  },
  submitProof: (storeId: string, orderId: string, body: { imageUrl: string; declaredAmount: number; declaredReference?: string }) =>
    apiFetch<PaymentProof>(`${base(storeId)}/orders/${orderId}/proof`, { method: 'POST', body }),
  proofStatus: (storeId: string, orderId: string) => apiFetch<{ status: string; reason?: string | null }>(`${base(storeId)}/orders/${orderId}/proof`),
  help: (storeId: string, body: { code?: string; providerMessage?: string; language?: 'en' | 'ur' | 'roman' }) =>
    apiFetch<PaymentHelp>(`${base(storeId)}/help`, { method: 'POST', body }),

  // Merchant
  pendingCod: (storeId: string) => apiFetch<PendingCodOrder[]>(`${base(storeId)}/cod/pending`),
  recordCodOutcome: (storeId: string, orderId: string, body: { outcome: 'collected' | 'refused'; amount?: number }) =>
    apiFetch<{ orderNumber: number }>(`${base(storeId)}/cod/orders/${orderId}/outcome`, { method: 'POST', body }),
  proofs: (storeId: string, status?: string) => apiFetch<PaymentProof[]>(`${base(storeId)}/proofs${status ? `?status=${status}` : ''}`),
  reviewProof: (storeId: string, proofId: string, body: { decision: 'accept' | 'reject'; reason?: string }) =>
    apiFetch<PaymentProof>(`${base(storeId)}/proofs/${proofId}/review`, { method: 'POST', body }),
  remittances: (storeId: string) => apiFetch<RemittanceRun[]>(`${base(storeId)}/remittances`),
  remittance: (storeId: string, runId: string) => apiFetch<RemittanceRun>(`${base(storeId)}/remittances/${runId}`),
  importRemittance: (storeId: string, body: { courier: string; csv: string; fileName?: string }) =>
    apiFetch<RemittanceRun>(`${base(storeId)}/remittances`, { method: 'POST', body }),

  // Owner
  settings: (storeId: string) => apiFetch<{ settings: PaymentSettings; gateways: { id: string; label: string }[] }>(`${base(storeId)}/settings`),
  updateSettings: (storeId: string, body: Partial<Record<keyof PaymentSettings, unknown>>) =>
    apiFetch<PaymentSettings>(`${base(storeId)}/settings`, { method: 'PATCH', body }),
}
