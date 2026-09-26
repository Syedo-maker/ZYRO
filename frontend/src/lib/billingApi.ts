import { apiFetch, ApiError } from './apiClient'
import type { BillingOverview, PlatformSummary, PlatformTenantRow, UpgradeHint } from '../types/billing'
import type { PaginationInfo } from '../types/api'

/** Plans, subscriptions and AI top-up packs. Owner-only on the server; nothing here changes a plan by itself, only Stripe's confirmation does. */
export const billingApi = {
  overview: (storeId: string) => apiFetch<BillingOverview>(`/stores/${storeId}/billing`),
  /** Returns a Stripe Checkout URL to send the browser to. */
  subscribe: (storeId: string, plan: 'PRO' | 'BUSINESS') => apiFetch<{ url: string }>(`/stores/${storeId}/billing/subscribe`, { method: 'POST', body: { plan } }),
  topUp: (storeId: string, pack: string) => apiFetch<{ url: string }>(`/stores/${storeId}/billing/top-up`, { method: 'POST', body: { pack } }),
  portal: (storeId: string) => apiFetch<{ url: string }>(`/stores/${storeId}/billing/portal`, { method: 'POST' }),
}

/** Super administrators only: per-store totals, no customer data. */
export const platformApi = {
  summary: () => apiFetch<PlatformSummary>('/platform/summary'),
  tenants: (query: { q?: string; limit?: number; offset?: number } = {}) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') p.set(k, String(v))
    const s = p.toString()
    return apiFetch<{ data: PlatformTenantRow[]; pagination: PaginationInfo }>(`/platform/tenants${s ? `?${s}` : ''}`)
  },
}

/** The upgrade suggestion carried by a 402 plan-limit or AI-quota error, if it has one. */
export function upgradeHintOf(err: unknown): UpgradeHint | null {
  if (!(err instanceof ApiError) || err.status !== 402) return null
  const hint = err.extra.upgrade as UpgradeHint | undefined
  return hint ?? null
}

/** Money for a price in the smallest currency unit: "$12", or "$4.50" when there are cents. */
export function formatPlanPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}
