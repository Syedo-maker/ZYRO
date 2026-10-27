import { apiFetch } from './apiClient'
import type { Category } from '../types/api'

/** A store's own product categories (Categories page, and the dropdown on the product form). */
export const categoriesApi = {
  list: (storeId: string) => apiFetch<Category[]>(`/stores/${storeId}/categories`),
  create: (storeId: string, name: string) => apiFetch<Category>(`/stores/${storeId}/categories`, { method: 'POST', body: { name } }),
  update: (storeId: string, categoryId: string, body: { name?: string; active?: boolean }) =>
    apiFetch<Category>(`/stores/${storeId}/categories/${categoryId}`, { method: 'PATCH', body }),
  remove: (storeId: string, categoryId: string) => apiFetch<void>(`/stores/${storeId}/categories/${categoryId}`, { method: 'DELETE' }),
}
