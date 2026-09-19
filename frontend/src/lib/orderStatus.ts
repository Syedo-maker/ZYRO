import type { OrderStatus } from '../types/commerce'

type Tone = 'success' | 'warning' | 'danger' | 'neutral'

/** Status names as a shopper or merchant reads them ("paid" is shown as Processing). */
export const ORDER_STATUS_META: Record<OrderStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'neutral' },
  paid: { label: 'Processing', tone: 'warning' },
  fulfilled: { label: 'Fulfilled', tone: 'success' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  refunded: { label: 'Refunded', tone: 'neutral' },
}
