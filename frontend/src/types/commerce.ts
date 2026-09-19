// Mirrors the cart, checkout, order and shipping schemas in backend/openapi.yaml.
import type { Store } from './api'

export interface StoreProfile extends Store {
  currency: string
}

export interface CartItem {
  id: string
  productId: string
  title: string
  imageUrl: string | null
  quantity: number
  unitPrice: number
  lineTotal: number
  availableStock: number
}

export interface Cart {
  items: CartItem[]
  subtotal: number
  currency: string
}

export interface ShippingZone {
  id: string
  name: string
  region: string
  rateAmount: number
}

export interface ShippingZoneInput {
  name: string
  region: string
  rateAmount: number
}

export interface Quote {
  currency: string
  subtotal: number
  discountAmount: number
  taxAmount: number
  shippingAmount: number
  total: number
}

export type OrderStatus = 'pending' | 'paid' | 'fulfilled' | 'completed' | 'cancelled' | 'refunded'
export type SalesChannel = 'online' | 'pos'
export type ShipmentStatus = 'pending' | 'shipped' | 'delivered' | 'cancelled'

export interface OrderItem {
  productId: string
  productTitleSnapshot: string
  unitPrice: number
  quantity: number
  lineTotal: number
}

export interface ShippingAddress {
  line1: string | null
  line2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
}

export interface OrderPayment {
  id: string
  method: 'cash' | 'card' | 'stripe' | 'other'
  amount: number
  status: 'pending' | 'succeeded' | 'failed' | 'refunded'
}

export interface OrderRefund {
  id: string
  paymentId: string
  amount: number
  method: OrderPayment['method']
  reason: string | null
  restocked: boolean
  createdAt: string
}

export interface OrderShipment {
  carrier: string | null
  trackingNumber: string | null
  status: ShipmentStatus
  shippedAt: string | null
  deliveredAt: string | null
}

export interface Order {
  id: string
  storeId: string
  orderNumber: number
  channel: SalesChannel
  status: OrderStatus
  customer: { name: string | null; email: string | null } | null
  guestEmail: string | null
  shippingName: string | null
  shippingAddress: ShippingAddress | null
  subtotal: number
  discountAmount: number
  taxAmount: number
  shippingAmount: number
  total: number
  currency: string
  items: OrderItem[]
  payments: OrderPayment[]
  refunds: OrderRefund[]
  shipment: OrderShipment | null
  createdAt: string
}

export interface OrderListResponse {
  data: Order[]
  pagination: { total: number; limit: number; offset: number }
}

export interface OrderListFilters {
  status?: OrderStatus
  channel?: SalesChannel
  q?: string
  limit?: number
  offset?: number
}

export type CheckoutState = 'pending' | 'completed' | 'expired' | 'refunded' | 'failed'

export interface CheckoutSessionStatus {
  state: CheckoutState
  order: {
    orderNumber: number
    status: OrderStatus
    total: number
    currency: string
    email: string | null
    shippingName: string | null
    items: { title: string; quantity: number; lineTotal: number }[]
  } | null
}
