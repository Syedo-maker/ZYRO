import { apiFetch } from './apiClient'
import type {
  HeldSale,
  ManualDiscount,
  PosCustomer,
  PosDailyReport,
  PosProduct,
  PosQuote,
  PosSession,
  PosShift,
  ReturnInput,
  Sale,
  SaleInput,
  SaleListResponse,
} from '../types/pos'

const base = (storeId: string) => `/stores/${storeId}/pos`

function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const posApi = {
  session: (storeId: string) => apiFetch<PosSession>(`${base(storeId)}/session`),
  updateSettings: (storeId: string, maxCashierDiscountPercent: number) =>
    apiFetch<{ maxCashierDiscountPercent: number }>(`${base(storeId)}/settings`, {
      method: 'PUT',
      body: { maxCashierDiscountPercent },
    }),

  searchProducts: (storeId: string, query: { q?: string; code?: string }) =>
    apiFetch<PosProduct[]>(`${base(storeId)}/products${qs(query)}`),
  searchCustomers: (storeId: string, q?: string) =>
    apiFetch<PosCustomer[]>(`${base(storeId)}/customers${qs({ q })}`),
  createCustomer: (storeId: string, body: { name?: string; email?: string; phone?: string }) =>
    apiFetch<PosCustomer>(`${base(storeId)}/customers`, { method: 'POST', body }),

  currentShift: (storeId: string) => apiFetch<PosShift | null>(`${base(storeId)}/shift`),
  openShift: (storeId: string, openingFloat: number) =>
    apiFetch<PosShift>(`${base(storeId)}/shift/open`, { method: 'POST', body: { openingFloat } }),
  closeShift: (storeId: string, body: { countedCash: number; note?: string }) =>
    apiFetch<PosShift>(`${base(storeId)}/shift/close`, { method: 'POST', body }),

  quote: (storeId: string, items: { productId: string; quantity: number }[], discount: ManualDiscount | null) =>
    apiFetch<PosQuote>(`${base(storeId)}/quote`, { method: 'POST', body: { items, discount } }),
  createSale: (storeId: string, body: SaleInput) =>
    apiFetch<Sale>(`${base(storeId)}/sales`, { method: 'POST', body }),
  listSales: (storeId: string, query: { q?: string; from?: string; to?: string; limit?: number; offset?: number }) =>
    apiFetch<SaleListResponse>(`${base(storeId)}/sales${qs(query)}`),
  getSale: (storeId: string, orderId: string) => apiFetch<Sale>(`${base(storeId)}/sales/${orderId}`),
  returnItems: (storeId: string, orderId: string, body: ReturnInput) =>
    apiFetch<Sale>(`${base(storeId)}/sales/${orderId}/returns`, { method: 'POST', body }),

  listHeld: (storeId: string) => apiFetch<HeldSale[]>(`${base(storeId)}/held`),
  holdSale: (
    storeId: string,
    body: { items: { productId: string; quantity: number }[]; discount: ManualDiscount | null; customerId?: string; label?: string }
  ) => apiFetch<HeldSale>(`${base(storeId)}/held`, { method: 'POST', body }),
  resumeHeld: (storeId: string, heldId: string) =>
    apiFetch<HeldSale>(`${base(storeId)}/held/${heldId}/resume`, { method: 'POST' }),
  discardHeld: (storeId: string, heldId: string) =>
    apiFetch<void>(`${base(storeId)}/held/${heldId}`, { method: 'DELETE' }),

  dailyReport: (storeId: string, from: Date, to: Date) =>
    apiFetch<PosDailyReport>(`${base(storeId)}/reports/daily${qs({ from: from.toISOString(), to: to.toISOString() })}`),
}

/** One unguessable id per sale attempt, so retrying "Charge" can never ring the sale up twice. */
export function newRequestId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return `sale-${c.randomUUID()}`
  return `sale-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}
