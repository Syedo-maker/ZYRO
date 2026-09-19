import { apiFetch } from './apiClient'
import type {
  Order,
  OrderListFilters,
  OrderListResponse,
  ShipmentStatus,
  ShippingZone,
  ShippingZoneInput,
} from '../types/commerce'

function queryString(filters: OrderListFilters): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export const ordersApi = {
  list: (storeId: string, filters: OrderListFilters = {}) =>
    apiFetch<OrderListResponse>(`/stores/${storeId}/orders${queryString(filters)}`),
  get: (storeId: string, orderId: string) => apiFetch<Order>(`/stores/${storeId}/orders/${orderId}`),
  updateStatus: (storeId: string, orderId: string, status: 'fulfilled' | 'cancelled') =>
    apiFetch<Order>(`/stores/${storeId}/orders/${orderId}/status`, { method: 'PATCH', body: { status } }),
  refund: (storeId: string, orderId: string, body: { reason?: string; restock?: boolean }) =>
    apiFetch<Order>(`/stores/${storeId}/orders/${orderId}/refund`, { method: 'POST', body }),
  updateShipment: (
    storeId: string,
    orderId: string,
    body: { carrier?: string; trackingNumber?: string; status?: ShipmentStatus }
  ) => apiFetch<Order>(`/stores/${storeId}/orders/${orderId}/shipment`, { method: 'PUT', body }),
}

export const shippingZonesApi = {
  list: (storeId: string) => apiFetch<ShippingZone[]>(`/stores/${storeId}/shipping-zones`),
  create: (storeId: string, input: ShippingZoneInput) =>
    apiFetch<ShippingZone>(`/stores/${storeId}/shipping-zones`, { method: 'POST', body: input }),
  update: (storeId: string, zoneId: string, input: ShippingZoneInput) =>
    apiFetch<ShippingZone>(`/stores/${storeId}/shipping-zones/${zoneId}`, { method: 'PUT', body: input }),
  remove: (storeId: string, zoneId: string) =>
    apiFetch<void>(`/stores/${storeId}/shipping-zones/${zoneId}`, { method: 'DELETE' }),
}

/** A readable message for an API failure, falling back to a generic one. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof Error) {
    const detail = (err as { detail?: string }).detail
    return detail ? `${err.message}: ${detail}` : err.message
  }
  return fallback
}
