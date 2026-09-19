import { apiFetch } from './apiClient'
import { getGuestSessionId } from './guestSession'
import type { Cart, CheckoutSessionStatus, Quote, ShippingZone, StoreProfile } from '../types/commerce'

// Cart and checkout calls identify the shopper by login when there is one, otherwise by
// the guest session id (the API prefers the bearer token when both are present).
const guest = () => ({ 'X-Guest-Session-Id': getGuestSessionId() })

export const storefrontApi = {
  getStore: (storeId: string) => apiFetch<StoreProfile>(`/stores/${storeId}`),
  listShippingZones: (storeId: string) => apiFetch<ShippingZone[]>(`/stores/${storeId}/shipping-zones`),
}

export const cartApi = {
  get: (storeId: string) => apiFetch<Cart>(`/stores/${storeId}/cart`, { headers: guest() }),
  add: (storeId: string, productId: string, quantity: number) =>
    apiFetch<Cart>(`/stores/${storeId}/cart/items`, { method: 'POST', body: { productId, quantity }, headers: guest() }),
  setQuantity: (storeId: string, productId: string, quantity: number) =>
    apiFetch<Cart>(`/stores/${storeId}/cart/items/${productId}`, { method: 'PATCH', body: { quantity }, headers: guest() }),
  remove: (storeId: string, productId: string) =>
    apiFetch<Cart>(`/stores/${storeId}/cart/items/${productId}`, { method: 'DELETE', headers: guest() }),
}

export const checkoutApi = {
  quote: (storeId: string, shippingZoneId?: string) =>
    apiFetch<Quote>(`/stores/${storeId}/checkout/quote`, { method: 'POST', body: { shippingZoneId }, headers: guest() }),
  createSession: (storeId: string, shippingZoneId?: string) =>
    apiFetch<{ checkoutUrl: string }>(`/stores/${storeId}/checkout/session`, {
      method: 'POST',
      body: { shippingZoneId },
      headers: guest(),
    }),
  getSessionStatus: (storeId: string, sessionId: string) =>
    apiFetch<CheckoutSessionStatus>(`/stores/${storeId}/checkout/sessions/${encodeURIComponent(sessionId)}`),
}
