import { apiFetch } from './apiClient'

export interface TrendFact {
  id: string
  kind: 'platform' | 'external'
  text: string
  source: string
  /** The last date the fact covers, "YYYY-MM-DD". */
  date: string
  url?: string
}

export interface TrendReport {
  id: string
  market: string
  category: string
  name: string
  weekStart: string
  covers: { from: string; to: string }
  /** published, no_data (nothing to report) or suppressed (too few stores to stay anonymous). */
  status: 'published' | 'no_data' | 'suppressed'
  source: 'ai' | 'template' | 'none'
  lines: { text: string; cites: string[] }[]
  facts: TrendFact[]
  createdAt: string
}

export interface StoreTrends {
  market: string
  categories: { category: string; name: string; report: TrendReport | null }[]
}

export interface TrendImport {
  id: string
  source: string
  market: string
  category: string
  geo: string
  terms: string[]
  points: number
  periodEnd: string
  fileName: string | null
  createdAt: string
}

/** The Trend Scout (Part D): a store's market reports, and the platform administrator's tools. */
export const trendsApi = {
  forStore: (storeId: string) => apiFetch<StoreTrends>(`/stores/${storeId}/trends`),
  platformReports: () => apiFetch<{ weekStart: string | null; reports: (TrendReport & { storeCount: number })[] }>('/platform/trends'),
  imports: () => apiFetch<TrendImport[]>('/platform/trends/imports'),
  importGoogleTrends: (body: { csv: string; market: string; category: string; fileName?: string }) =>
    apiFetch<TrendImport>('/platform/trends/imports', { method: 'POST', body }),
  runNow: () =>
    apiFetch<{ weekStart: string; reports: number; published: number; suppressed: number; noData: number; existing: number; failed: number }>('/platform/trends/run', { method: 'POST' }),
}
