import { apiFetch } from './apiClient'
import type { ProductIdeaRequest, ProductIdeas, TrendingKeywords } from '../types/ideas'

/**
 * "Write with AI" on the add-product form (Issue 1).
 *
 * One call to `suggest` is one AI generation off the shop's monthly allowance, however many of the
 * suggestions the merchant reads or ignores. `keywords` costs nothing: it only reads the cached
 * keyword list, so the form can show what shoppers are searching for before anybody spends
 * anything.
 */
export const productIdeasApi = {
  suggest: (storeId: string, draft: ProductIdeaRequest) =>
    apiFetch<ProductIdeas>(`/stores/${storeId}/product-ideas`, { method: 'POST', body: draft }),
  keywords: (storeId: string, category?: string) =>
    apiFetch<TrendingKeywords>(`/stores/${storeId}/product-ideas/keywords${category ? `?category=${encodeURIComponent(category)}` : ''}`),
}
