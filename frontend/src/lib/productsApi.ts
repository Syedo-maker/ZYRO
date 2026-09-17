import { apiFetch } from './apiClient'
import type { Product, ProductInput, ProductListResponse } from '../types/api'

export const productsApi = {
  list: (storeId: string) => apiFetch<ProductListResponse>(`/stores/${storeId}/products`),
  create: (storeId: string, input: ProductInput) =>
    apiFetch<Product>(`/stores/${storeId}/products`, { method: 'POST', body: input }),
  update: (storeId: string, productId: string, input: ProductInput) =>
    apiFetch<Product>(`/stores/${storeId}/products/${productId}`, { method: 'PUT', body: input }),
  remove: (storeId: string, productId: string) =>
    apiFetch<void>(`/stores/${storeId}/products/${productId}`, { method: 'DELETE' }),
}

export const uploadsApi = {
  uploadImage: async (storeId: string, file: File): Promise<string> => {
    const form = new FormData()
    form.append('file', file)
    const { url } = await apiFetch<{ url: string }>(`/stores/${storeId}/uploads/images`, {
      method: 'POST',
      body: form,
    })
    return url
  },
}
