// Mirrors backend/src/modules/stores/directory.service.ts. Public information only: there is
// nothing here about a shop's orders, revenue, plan or owner.

export interface DirectoryStore {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  themeColor: string | null
  currency: string
  description: string | null
  /** The category most of this shop's products are in; null when it sells a bit of everything. */
  category: string | null
  productCount: number
}

export interface DirectoryPage {
  stores: DirectoryStore[]
  total: number
  limit: number
  offset: number
}

export interface DirectoryQuery {
  q?: string
  category?: string
  limit?: number
  offset?: number
}

/** What the owner sees in their settings: whether their shop is listed, and if not, why. */
export interface DirectoryListing {
  listedInDirectory: boolean
  description: string | null
  listed: boolean
  productCount: number
  minimumProducts: number
  reason: string | null
}
