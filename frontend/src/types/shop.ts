// Mirrors the search, review, account, analytics and discount schemas in backend/openapi.yaml.
import type { PaginationInfo, Product } from './api'
import type { Order } from './commerce'

export type ProductSort = 'relevance' | 'newest' | 'price_asc' | 'price_desc' | 'title'

export interface ProductQuery {
  q?: string
  category?: string
  minPrice?: number
  maxPrice?: number
  inStock?: boolean
  sort?: ProductSort
  limit?: number
  offset?: number
}

export interface ProductPage {
  data: Product[]
  pagination: PaginationInfo
}

export interface CategoryCount {
  name: string
  count: number
}

export interface Suggestion {
  id: string
  title: string
  category: string
}

// ---- Reviews ----

export type ReviewSort = 'newest' | 'oldest' | 'highest' | 'lowest'

export interface Review {
  id: string
  productId: string
  authorName: string
  rating: number
  title: string | null
  comment: string | null
  verifiedPurchase: boolean
  merchantReply: string | null
  merchantRepliedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface OwnReview extends Review {
  status: 'published' | 'hidden'
}

export interface ModerationReview extends OwnReview {
  productTitle: string
}

export interface ReviewPage {
  data: Review[]
  pagination: PaginationInfo
  averageRating: number | null
  reviewCount: number
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>
  myReview: OwnReview | null
}

export interface ReviewInput {
  rating: number
  title?: string
  comment?: string
}

// ---- Customer account ----

export interface MyOrdersPage {
  data: Order[]
  pagination: PaginationInfo
}

// ---- Analytics ----

export interface ChannelFigures {
  orders: number
  grossSales: number
  refunds: number
  netSales: number
}

export interface AnalyticsSummary {
  range: { from: string; to: string; days: number; tzOffsetMinutes: number }
  currency: string
  generatedAt: string
  cached: boolean
  totals: {
    orders: number
    grossSales: number
    discountsGiven: number
    taxCollected: number
    shippingCharged: number
    refunds: { count: number; total: number }
    netSales: number
    averageOrderValue: number
    unitsSold: number
    productMargin: number
    costCoveragePercent: number
    newCustomers: number
  }
  byChannel: (ChannelFigures & { channel: 'online' | 'pos'; averageOrderValue: number; shareOfNetSales: number })[]
  daily: { date: string; online: ChannelFigures; pos: ChannelFigures; netSales: number }[]
  topProducts: {
    productId: string
    title: string
    unitsSold: number
    revenue: number
    unitsOnline: number
    unitsPos: number
    productMargin: number | null
  }[]
}

// ---- Discount codes ----

export type DiscountStatus = 'active' | 'inactive' | 'expired' | 'used_up'

export interface DiscountCode {
  id: string
  code: string
  type: 'percentage' | 'fixed'
  value: number
  minSubtotal: number | null
  usageLimit: number | null
  expiresAt: string | null
  usageCount: number
  active: boolean
  status: DiscountStatus
  createdAt: string
}

export interface DiscountInput {
  code: string
  type: 'percentage' | 'fixed'
  value: number
  minSubtotal?: number
  usageLimit?: number
  expiresAt?: string
}

export interface DiscountUpdate {
  active?: boolean
  usageLimit?: number | null
  expiresAt?: string | null
  minSubtotal?: number | null
}
