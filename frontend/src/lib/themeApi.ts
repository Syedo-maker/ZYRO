import { apiFetch } from './apiClient'
import type { StoreTheme, ThemeTokens } from './storeTheme'

// Mirrors the Store Themes endpoints in backend/openapi.yaml (tag `themes`). Owner only.

export interface ThemeCorrection {
  field: 'background' | 'text' | 'primary' | 'accent'
  from: string
  to: string
  message: string
}

export interface ThemeState {
  draft: StoreTheme
  tokens: ThemeTokens
  checks: { pair: string; ratio: number; min: number }[]
  corrections: ThemeCorrection[]
  published: StoreTheme | null
  publishedAt: string | null
  hasUnpublishedChanges: boolean
  canUndo: boolean
  canRedo: boolean
}

export interface ThemePreset {
  id: string
  name: string
  description: string
  theme: StoreTheme
  tokens: ThemeTokens
}

export interface ThemeFont {
  id: StoreTheme['font']
  label: string
  mood: string
  sans: string
  display: string
}

export interface DesignOption {
  name: string
  reason: string
  theme: StoreTheme
  tokens: ThemeTokens
}

export interface AssistantAnswer {
  reply: string
  question: string | null
  options: DesignOption[]
  applied: number
  state: ThemeState
}

export interface PolishItem {
  area: 'contrast' | 'mobile' | 'spacing' | 'fonts' | 'hierarchy'
  message: string
}

export interface PolishResult {
  fixes: PolishItem[]
  notes: PolishItem[]
  summary: string
  state: ThemeState
}

export type QuickAction = 'bolder' | 'simpler' | 'logo'

export const themeApi = {
  get: (storeId: string) => apiFetch<ThemeState>(`/stores/${storeId}/theme`),
  options: (storeId: string) => apiFetch<{ presets: ThemePreset[]; fonts: ThemeFont[] }>(`/stores/${storeId}/theme/options`),
  saveDraft: (storeId: string, theme: StoreTheme) => apiFetch<ThemeState>(`/stores/${storeId}/theme/draft`, { method: 'PUT', body: { theme } }),
  undo: (storeId: string) => apiFetch<ThemeState>(`/stores/${storeId}/theme/undo`, { method: 'POST' }),
  redo: (storeId: string) => apiFetch<ThemeState>(`/stores/${storeId}/theme/redo`, { method: 'POST' }),
  publish: (storeId: string) => apiFetch<ThemeState>(`/stores/${storeId}/theme/publish`, { method: 'POST' }),
  versions: (storeId: string) => apiFetch<{ versions: { id: string; publishedAt: string; theme: StoreTheme }[] }>(`/stores/${storeId}/theme/versions`),
  restore: (storeId: string, versionId: string) => apiFetch<ThemeState>(`/stores/${storeId}/theme/versions/${encodeURIComponent(versionId)}/restore`, { method: 'POST' }),
  ask: (storeId: string, body: { message?: string; action?: QuickAction; logoColors?: string[] }) =>
    apiFetch<AssistantAnswer>(`/stores/${storeId}/theme/assistant`, { method: 'POST', body }),
  polish: (storeId: string) => apiFetch<PolishResult>(`/stores/${storeId}/theme/polish`, { method: 'POST' }),
}
