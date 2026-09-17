export interface MyStore {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  themeColor: string | null
  role: 'owner' | 'staff'
}
