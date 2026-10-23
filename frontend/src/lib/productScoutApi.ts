import { apiFetch } from './apiClient'

export interface ScoutFigures {
  units: number
  orders: number
  stores: number
  previousUnits: number | null
  growthPercent: number | null
  isNew: boolean
}

export interface ScoutProduct extends ScoutFigures {
  id: string
  name: string
  category: string
  categoryName: string
  why: string
  whySource: 'ai' | 'template'
  starter: string
  starterSource: 'ai' | 'template'
}

export interface ScoutMarketData {
  category: string
  name: string
  weekStart: string
  lines: string[]
  sources: string[]
}

/** GET /stores/{storeId}/product-scout: what is selling across ZYRO in this store's market. */
export interface ProductScout {
  status: 'ready' | 'no_data'
  demo: boolean
  market: string
  periodDays: 7 | 30
  window: { from: string; to: string } | null
  generatedAt: string | null
  rules: { minStores: number; maxSharePercent: number }
  categories: (ScoutFigures & { key: string; name: string })[]
  topSellers: ScoutProduct[]
  fastestGrowing: ScoutProduct[]
  rising: { category: string; name: string; products: ScoutProduct[] }[]
  marketData: ScoutMarketData[]
  notEnoughData: string[]
  store: { productCount: number; categories: { id: string; name: string }[] }
}

/** What "Add to my store" hands the Add Product form. Never saved by itself. */
export interface ScoutPrefill {
  id: string
  title: string
  description: string
  categoryName: string
}

export const productScoutApi = {
  get: (storeId: string, period: 7 | 30, category?: string) =>
    apiFetch<ProductScout>(`/stores/${storeId}/product-scout?period=${period}${category ? `&category=${encodeURIComponent(category)}` : ''}`),
}

export const prefillFrom = (p: ScoutProduct): ScoutPrefill => ({ id: p.id, title: p.name, description: p.starter, categoryName: p.categoryName })
