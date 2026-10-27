import type { ReactNode } from 'react'
import { Alert } from '../../components/ui/Alert'
import { useAuth } from '../../context/AuthContext'
import { can, type StorePermission } from '../../lib/permissions'

/**
 * Shows a page only to someone with the permission it needs. Anyone else (a cashier opening Orders,
 * say) sees the page's title and one line saying what is missing, and nothing more: no tabs, filters
 * or buttons, no empty tables, and no request for data they would only be refused. The server
 * refuses them either way; this keeps the page from showing anything beyond that.
 */
export function NeedsPermission({ permission, title, what, children }: { permission: StorePermission; title: string; what: string; children: ReactNode }) {
  const { activeStore } = useAuth()
  if (can(activeStore, permission)) return <>{children}</>
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <h1 className="font-display text-xl font-bold">{title}</h1>
      <Alert tone="info">{what}, which your account does not have in this store. Ask the store owner if you need it.</Alert>
    </div>
  )
}
