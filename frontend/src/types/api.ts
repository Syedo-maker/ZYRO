// Mirrors the relevant schemas in backend/openapi.yaml.

export interface User {
  id: string
  email: string
  name: string | null
}

export interface Store {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  themeColor: string | null
}

export interface AuthSession {
  accessToken: string
  user: User
}

export interface Product {
  id: string
  storeId: string
  title: string
  description: string
  price: number
  stock: number
  sku?: string | null
  barcode?: string | null
  taxable?: boolean
  category: string
  images: string[]
  aiDescriptionStatus: 'draft' | 'published' | null
}

export interface ProductInput {
  title: string
  description?: string
  price: number
  stock: number
  /** Scanned at the register; unique per store. */
  sku?: string
  barcode?: string
  taxable?: boolean
  category: string
  images?: string[]
}

export interface PaginationInfo {
  total: number
  limit: number
  offset: number
}

export interface ProductListResponse {
  data: Product[]
  pagination: PaginationInfo
}
