import { apiFetch } from './apiClient'
import type { DirectoryPage, DirectoryQuery } from '../types/directory'

function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

/** The public shop directory (Issue 2). No token: a shopper looking for a shop has no account yet. */
export const directoryApi = {
  list: (query: DirectoryQuery = {}) => apiFetch<DirectoryPage>(`/stores${qs({ ...query })}`),
  categories: () => apiFetch<{ categories: string[] }>('/stores/categories'),
}
