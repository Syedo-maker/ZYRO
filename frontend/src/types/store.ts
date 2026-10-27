export interface MyStore {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  themeColor: string | null
  role: 'owner' | 'staff'
  /** What this user may do here ("products_write", ...): everything for the owner. See lib/permissions.ts. */
  permissions: string[]
}
