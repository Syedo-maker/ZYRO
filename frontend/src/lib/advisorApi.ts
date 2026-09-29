import { apiFetch } from './apiClient'

export interface GrowthTip {
  id: string
  weekStart: string
  message: string
  /** `ai` when the AI wrote it, `template` when it was written from the same figures without the AI. */
  source: 'ai' | 'template'
  topics: { key: string; kind: 'praise' | 'tip' | 'upgrade' }[]
  createdAt: string
}

export interface AdvisorState {
  enabled: boolean
  tip: GrowthTip | null
}

/** The Growth Advisor's weekly tip (Part C). */
export const advisorApi = {
  get: (storeId: string) => apiFetch<AdvisorState>(`/stores/${storeId}/advisor`),
  /** Runs this week's check now instead of waiting for Monday; still at most one tip a week. */
  check: (storeId: string) => apiFetch<{ tip: GrowthTip | null }>(`/stores/${storeId}/advisor/check`, { method: 'POST' }),
  setEnabled: (storeId: string, enabled: boolean) => apiFetch<AdvisorState>(`/stores/${storeId}/advisor`, { method: 'PATCH', body: { enabled } }),
  dismiss: (storeId: string, tipId: string) => apiFetch<void>(`/stores/${storeId}/advisor/tips/${tipId}/dismiss`, { method: 'POST' }),
}
