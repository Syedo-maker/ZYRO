// Mirrors the POS schemas in backend/openapi.yaml.
import type { Order, OrderItem, OrderPayment } from './commerce'

export type TenderMethod = 'cash' | 'card' | 'other'

export interface PosSession {
  user: { id: string; name: string | null; email: string }
  isOwner: boolean
  permissions: { sell: boolean; refunds: boolean; analytics: boolean; unlimitedDiscounts: boolean }
  store: { id: string; name: string; currency: string; taxRate: number }
  settings: { maxCashierDiscountPercent: number }
}

export interface PosProduct {
  id: string
  title: string
  price: number
  taxable: boolean
  sku: string | null
  barcode: string | null
  category: string
  image: string | null
  stock: number
}

export interface PosCustomer {
  id: string
  name: string | null
  email: string | null
  phone: string | null
}

export interface ManualDiscount {
  type: 'percentage' | 'fixed'
  value: number
  reason?: string
}

export interface CartLine {
  productId: string
  title: string
  quantity: number
  /** Known when the item was added from search; a resumed held sale learns it from the quote. */
  unitPrice: number | null
  stock: number | null
  image: string | null
}

export interface PosQuote {
  currency: string
  taxRate: number
  lines: { productId: string; title: string; unitPrice: number; quantity: number; taxable: boolean; lineTotal: number }[]
  subtotal: number
  discountAmount: number
  discountPercent: number
  taxAmount: number
  total: number
  shortages: { productId: string; requested: number; available: number }[]
}

export interface ShiftTotals {
  salesCount: number
  grossSales: number
  cashSales: number
  cardSales: number
  otherSales: number
  refundsTotal: number
  cashRefunds: number
  expectedCash: number
}

export interface PosShift {
  id: string
  status: 'open' | 'closed'
  locationId: string
  openedAt: string
  closedAt: string | null
  openedBy: { id: string; name: string | null }
  closedBy: { id: string; name: string | null } | null
  openingFloat: number
  expectedCash: number
  countedCash: number | null
  variance: number | null
  note: string | null
  totals: ShiftTotals
}

export interface SaleItem extends OrderItem {
  id: string
  returnedQuantity: number
}

export interface SalePayment extends OrderPayment {
  tenderedAmount: number | null
  changeGiven: number | null
}

export interface SaleReturn {
  id: string
  amount: number
  method: TenderMethod
  reason: string | null
  restocked: boolean
  createdAt: string
  items: { orderItemId: string; productId: string; productTitleSnapshot: string; quantity: number; amount: number }[]
}

export interface Sale extends Omit<Order, 'items' | 'payments'> {
  items: SaleItem[]
  payments: SalePayment[]
  returns: SaleReturn[]
  discountReason: string | null
  shiftId: string | null
  store: { name: string; currency: string }
  cashier: { id: string; name: string } | null
  changeDue: number
}

/** A sale as the history list returns it: the order, without the receipt extras (store, cashier, change). */
export type SaleSummary = Omit<Sale, 'store' | 'cashier' | 'changeDue'>

export interface SaleListResponse {
  data: SaleSummary[]
  pagination: { total: number; limit: number; offset: number }
}

export interface SaleInput {
  items: { productId: string; quantity: number }[]
  discount?: ManualDiscount | null
  customerId?: string
  payments: { method: TenderMethod; amount: number; tendered?: number }[]
  clientRequestId: string
}

export interface ReturnInput {
  items: { orderItemId: string; quantity: number }[]
  refundMethod?: TenderMethod
  reason?: string
  restock?: boolean
}

export interface HeldSale {
  id: string
  label: string | null
  customerId: string | null
  customerName: string | null
  cashierName: string | null
  itemCount: number
  items: { productId: string; title: string; quantity: number }[]
  discount: ManualDiscount | null
  createdAt: string
}

export interface PosDailyReport {
  from: string
  to: string
  currency: string
  salesCount: number
  grossSales: number
  discountsGiven: number
  taxCollected: number
  refunds: { count: number; total: number }
  netSales: number
  averageSale: number
  byPaymentMethod: { method: string; sales: number; refunds: number; net: number }[]
  byCashier: { userId: string | null; name: string; salesCount: number; sales: number; refunds: number; net: number }[]
  topItems: { productId: string; title: string; quantity: number; revenue: number }[]
  shifts: PosShift[]
}
