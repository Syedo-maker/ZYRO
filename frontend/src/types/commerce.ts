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
  /** The discount code that was applied, if any. */
  discount?: { code: string; type: 'percentage' | 'fixed'; value: number } | null
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
  /** The price paid per unit. */
  unitPrice: number
  /** The product's MRP and its own discount per unit at the time of sale; unitMrp - unitDiscount = unitPrice. */
  unitMrp: number
  unitDiscount: number
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
  /** cod, bank_transfer and gateway are the local ways to pay (Part E). */
  method: 'cash' | 'card' | 'stripe' | 'other' | 'cod' | 'bank_transfer' | 'gateway'
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
  /** The discount code the order used, when it used one. */
  discountCode?: string | null
  taxAmount: number
  shippingAmount: number
  total: number
  currency: string
  /** Items taken back from an in-store sale (whole-order refunds are in `refunds`). */
  returns?: { id: string; amount: number }[]
  /** What the shopper saved on the products' own discounts (MRP minus price, every unit bought), for "you saved". */
  savings: number
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
    /** What the shopper saved on the products' own discounts; 0 for none. */
    savings: number
  } | null
}
