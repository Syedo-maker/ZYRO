// Talks to the AI Content Tools endpoints (Implementation_Plan.md Phase 4, Module 6) per
// backend/openapi.yaml. Every generate/regenerate/auto-tag/seo-metadata/summarize call spends
// one AI generation from the store's monthly quota (`aiUsageApi.getUsage`).
import { apiFetch } from './apiClient'
import type { Product } from '../types/api'
import type { AiDescriptionDraft, AiUsageQuota, AutoTagSuggestion, MarketingCopy, MarketingCopyInput, ReviewSummaryStatus, SeoMetadataSuggestion } from '../types/shop'

export const aiUsageApi = {
  get: (storeId: string) => apiFetch<AiUsageQuota>(`/stores/${storeId}/ai-usage`),
}

export const aiDescriptionApi = {
  /** The current draft (or last-published content), or null if nothing has been generated yet. Free: never calls the AI. */
  get: (storeId: string, productId: string) => apiFetch<AiDescriptionDraft | null>(`/stores/${storeId}/products/${productId}/ai-description`),
  generate: (storeId: string, productId: string) =>
    apiFetch<AiDescriptionDraft>(`/stores/${storeId}/products/${productId}/ai-description/generate`, { method: 'POST' }),
  update: (storeId: string, productId: string, content: string) =>
    apiFetch<AiDescriptionDraft>(`/stores/${storeId}/products/${productId}/ai-description`, { method: 'PATCH', body: { content } }),
  regenerate: (storeId: string, productId: string) =>
    apiFetch<AiDescriptionDraft>(`/stores/${storeId}/products/${productId}/ai-description/regenerate`, { method: 'POST' }),
  publish: (storeId: string, productId: string) =>
    apiFetch<Product>(`/stores/${storeId}/products/${productId}/ai-description/publish`, { method: 'POST' }),
}

export const aiSuggestionsApi = {
  autoTag: (storeId: string, productId: string) => apiFetch<AutoTagSuggestion>(`/stores/${storeId}/products/${productId}/auto-tag`, { method: 'POST' }),
  seoMetadata: (storeId: string, productId: string) => apiFetch<SeoMetadataSuggestion>(`/stores/${storeId}/products/${productId}/seo-metadata/generate`, { method: 'POST' }),
}

export const aiMarketingApi = {
  /** Promotional text for one channel and tone. Nothing is saved; costs one generation. */
  generate: (storeId: string, productId: string, body: MarketingCopyInput) =>
    apiFetch<MarketingCopy>(`/stores/${storeId}/products/${productId}/marketing-copy`, { method: 'POST', body }),
}

export const aiReviewSummaryApi = {
  get: (storeId: string, productId: string) => apiFetch<ReviewSummaryStatus>(`/stores/${storeId}/products/${productId}/reviews/summary`),
  generate: (storeId: string, productId: string) => apiFetch<ReviewSummaryStatus>(`/stores/${storeId}/products/${productId}/reviews/summarize`, { method: 'POST' }),
}
