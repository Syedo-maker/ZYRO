import { apiFetch } from './apiClient'

export interface CurrencySetting {
  currency: string
  /** True once the store has sold anything, or while a shopper is part-way through paying. */
  locked: boolean
  /** Why it is locked, in words for the merchant; null when it is not. */
  reason: string | null
  options: { code: string; name: string }[]
}

/** The owner's store settings (Settings page). */
export const storeSettingsApi = {
  currency: (storeId: string) => apiFetch<CurrencySetting>(`/stores/${storeId}/currency`),
  setCurrency: (storeId: string, currency: string) =>
    apiFetch<{ currency: string; currencyLocked: boolean }>(`/stores/${storeId}/currency`, { method: 'PATCH', body: { currency } }),
}
