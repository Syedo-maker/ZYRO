import { apiFetch } from './apiClient'
import type { Product } from '../types/api'
import type {
  AnalyticsSummary,
  CartRecoveryPerformance,
  CategoryCount,
  DiscountCode,
  DiscountInput,
  DiscountUpdate,
  ModerationReview,
  MyOrdersPage,
  OwnReview,
  ProductPage,
  ProductQuery,
  ReviewInput,
  ReviewPage,
  ReviewSort,
  Suggestion,
} from '../types/shop'
import type { PaginationInfo } from '../types/api'

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '' && v !== false) p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

/** Public catalog: browse, search, filter, suggestions and category counts. */
export const catalogApi = {
  list: (storeId: string, query: ProductQuery = {}) =>
    apiFetch<ProductPage>(`/stores/${storeId}/products${qs({ ...query })}`),
  get: (storeId: string, productId: string) => apiFetch<Product>(`/stores/${storeId}/products/${productId}`),
  suggest: (storeId: string, q: string) =>
    apiFetch<Suggestion[]>(`/stores/${storeId}/products/suggest${qs({ q })}`),
  categories: (storeId: string) => apiFetch<CategoryCount[]>(`/stores/${storeId}/products/categories`),
  /** "Products like this one" (Phase 6); an empty list when the recommendation service has nothing or is unavailable. */
  recommendations: (storeId: string, productId: string, limit = 4) =>
    apiFetch<{ data: Product[] }>(`/stores/${storeId}/products/${productId}/recommendations${qs({ limit })}`),
}

/** Reviews on the storefront (public to read, signed-in shoppers write their own). */
export const reviewsApi = {
  list: (storeId: string, productId: string, query: { sort?: ReviewSort; rating?: number; limit?: number; offset?: number } = {}) =>
    apiFetch<ReviewPage>(`/stores/${storeId}/products/${productId}/reviews${qs(query)}`),
  create: (storeId: string, productId: string, body: ReviewInput) =>
    apiFetch<OwnReview>(`/stores/${storeId}/products/${productId}/reviews`, { method: 'POST', body }),
  update: (storeId: string, productId: string, body: Partial<ReviewInput>) =>
    apiFetch<OwnReview>(`/stores/${storeId}/products/${productId}/reviews/mine`, { method: 'PUT', body }),
  remove: (storeId: string, productId: string) =>
    apiFetch<void>(`/stores/${storeId}/products/${productId}/reviews/mine`, { method: 'DELETE' }),
}

/** Moderation for the merchant. */
export const reviewsAdminApi = {
  list: (storeId: string, query: { status?: 'published' | 'hidden'; rating?: number; limit?: number; offset?: number } = {}) =>
    apiFetch<{ data: ModerationReview[]; pagination: PaginationInfo }>(`/stores/${storeId}/reviews${qs(query)}`),
  moderate: (storeId: string, reviewId: string, body: { status?: 'published' | 'hidden'; reply?: string | null }) =>
    apiFetch<ModerationReview>(`/stores/${storeId}/reviews/${reviewId}`, { method: 'PATCH', body }),
}

/** A signed-in shopper's own orders at a store. */
export const accountApi = {
  myOrders: (storeId: string, query: { limit?: number; offset?: number } = {}) =>
    apiFetch<MyOrdersPage>(`/stores/${storeId}/orders/mine${qs(query)}`),
}

export const cartRecoveryApi = {
  performance: (storeId: string) => apiFetch<CartRecoveryPerformance>(`/stores/${storeId}/cart-recovery/performance`),
}

export const analyticsApi = {
  summary: (storeId: string, from: Date, to: Date, tzOffsetMinutes: number) =>
    apiFetch<AnalyticsSummary>(
      `/stores/${storeId}/analytics/summary${qs({ from: from.toISOString(), to: to.toISOString(), tzOffsetMinutes })}`
    ),
}

export const discountsApi = {
  list: (storeId: string) => apiFetch<DiscountCode[]>(`/stores/${storeId}/discount-codes`),
  create: (storeId: string, body: DiscountInput) =>
    apiFetch<DiscountCode>(`/stores/${storeId}/discount-codes`, { method: 'POST', body }),
  update: (storeId: string, codeId: string, body: DiscountUpdate) =>
    apiFetch<DiscountCode>(`/stores/${storeId}/discount-codes/${codeId}`, { method: 'PATCH', body }),
}
