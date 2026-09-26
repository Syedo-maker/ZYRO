import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

interface NavItem {
  label: string
  to: string
  enabled: boolean
}

// Matches the sidebar in design/wireframes/AdminDashboard.dc.html / AdminCatalog.dc.html.
// Products (Phase 1) and Orders (Phase 2) are functional; the rest light up in the phases
// that build their backend (Dashboard and Marketing: Phase 3, per Implementation_Plan.md).
const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/admin/dashboard', enabled: true },
  { label: 'Products', to: '/admin/products', enabled: true },
  { label: 'Orders', to: '/admin/orders', enabled: true },
  { label: 'Team & register', to: '/admin/team', enabled: true },
  { label: 'Reviews', to: '/admin/reviews', enabled: true },
  { label: 'Marketing', to: '/admin/marketing', enabled: true },
  { label: 'Settings', to: '/admin/settings', enabled: false },
]

/** Only the store owner spends money, and only a platform operator sees the platform view. */
const OWNER_ITEM: NavItem = { label: 'Plan & billing', to: '/admin/billing', enabled: true }
const PLATFORM_ITEM: NavItem = { label: 'Platform', to: '/admin/platform', enabled: true }

export function AdminLayout() {
  const { isLoading, isAuthenticated, activeStore, user, logout } = useAuth()

  if (isLoading) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />

  const items = [
    ...NAV_ITEMS.filter((i) => i.enabled),
    ...(activeStore?.role === 'owner' ? [OWNER_ITEM] : []),
    ...(user?.platformAdmin ? [PLATFORM_ITEM] : []),
    ...NAV_ITEMS.filter((i) => !i.enabled),
  ]

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-bg">
      {/* A column on a wide screen; a row of links that scrolls sideways on a phone or tablet. */}
      <aside className="w-full lg:w-[220px] shrink-0 bg-text flex flex-row lg:flex-col items-center lg:items-stretch p-3 lg:p-4 gap-1 overflow-x-auto">
        <div className="font-display text-lg font-bold text-white px-2 lg:pb-6">ZYRO</div>
        {items.map((item) =>
          item.enabled ? (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-[10px] px-4 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-white/15 text-white font-semibold' : 'text-white/70 hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ) : (
            <span
              key={item.to}
              title="Coming in a later phase"
              className="whitespace-nowrap rounded-[10px] px-4 py-2.5 text-sm font-medium text-white/30 cursor-not-allowed"
            >
              {item.label}
            </span>
          )
        )}
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="min-h-[72px] bg-white border-b border-border flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 lg:px-8">
          <div className="text-[17px] font-semibold">{activeStore?.name ?? 'No store yet'}</div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {activeStore && (
              <a href={`/pos/${activeStore.id}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand hover:text-brand-hover">
                Open register
              </a>
            )}
            {activeStore && (
              <a
                href={`/store/${activeStore.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold text-brand hover:text-brand-hover"
              >
                View storefront
              </a>
            )}
            <span className="text-sm text-text-secondary">{user?.email}</span>
            <button onClick={() => void logout()} className="text-sm font-semibold text-brand hover:text-brand-hover">
              Log out
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-8 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
