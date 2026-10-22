// Mirrors the relevant schemas in backend/openapi.yaml.

export interface User {
  id: string
  email: string
  name: string | null
  /** True for a platform operator (can open the platform view). Only /users/me reports it. */
  platformAdmin?: boolean
  /**
   * Which experience this user last chose, "shopper" or "owner" (Issue 2). A routing hint only:
   * what they may actually do is decided per request and per shop by the server, never by this.
   */
  preferredExperience?: 'shopper' | 'owner' | null
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
  /** The full price (MRP), shown struck through when there is a discount. */
  actualPrice: number
  /** Null when there is no discount. */
  discountPrice: number | null
  /** What customers pay: the cart, checkout and orders use this. */
  salePrice: number
  /** Whole percent below the MRP, for the "% off" badge; null when there is none. */
  discountPercent: number | null
  /** The sale price under its name from before the three prices. Prefer salePrice. */
  price: number
  stock: number
  sku?: string | null
  barcode?: string | null
  taxable?: boolean
  /** Part G: the lowest price the merchant will accept when haggling. Merchant-only; shoppers never see it. */
  bargainMinPrice?: number | null
  /** The store's category; null only for a product listed before categories existed and not yet migrated. */
  categoryId: string | null
  /** The category's name, kept in step with it by the server. */
  category: string
  images: string[]
  /** Often filled from an AI auto-tag suggestion; the suggestion itself never writes here. */
  tags: string[]
  seoTitle?: string | null
  seoDescription?: string | null
  /** Mean of the published reviews (two decimals), or null when there are none. */
  averageRating?: number | null
  reviewCount?: number
  aiDescriptionStatus: 'draft' | 'published' | null
}

export interface ProductInput {
  title: string
  description?: string
  /** The full price (MRP). */
  actualPrice: number
  /** Empty (null) for no discount; on an edit, that removes one. At most the actual price. */
  discountPrice: number | null
  stock: number
  /** Scanned at the register; unique per store. */
  sku?: string
  barcode?: string
  taxable?: boolean
  bargainMinPrice?: number | null
  /** One of the store's active categories, chosen from the dropdown; never typed. */
  categoryId: string
  images?: string[]
  tags?: string[]
  seoTitle?: string
  seoDescription?: string
}

/** One of a store's own product categories. */
export interface Category {
  id: string
  /** As the owner typed it. */
  name: string
  active: boolean
  /** How many of the store's products are in it. */
  productCount: number
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
