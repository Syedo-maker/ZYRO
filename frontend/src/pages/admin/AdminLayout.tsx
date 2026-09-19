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
  { label: 'Dashboard', to: '/admin/dashboard', enabled: false },
  { label: 'Products', to: '/admin/products', enabled: true },
  { label: 'Orders', to: '/admin/orders', enabled: true },
  { label: 'Marketing', to: '/admin/marketing', enabled: false },
  { label: 'Settings', to: '/admin/settings', enabled: false },
]

export function AdminLayout() {
  const { isLoading, isAuthenticated, activeStore, user, logout } = useAuth()

  if (isLoading) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />

  return (
    <div className="min-h-screen flex bg-bg">
      <aside className="w-[220px] shrink-0 bg-text flex flex-col p-4 gap-1">
        <div className="font-display text-lg font-bold text-white px-2 pb-6">ZYRO</div>
        {NAV_ITEMS.map((item) =>
          item.enabled ? (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-[10px] px-4 py-2.5 text-sm font-medium transition-colors ${
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
              className="rounded-[10px] px-4 py-2.5 text-sm font-medium text-white/30 cursor-not-allowed"
            >
              {item.label}
            </span>
          )
        )}
      </aside>

      <div className="flex-1 flex flex-col">
        <header className="h-[72px] bg-white border-b border-border flex items-center justify-between px-8">
          <div className="text-[17px] font-semibold">{activeStore?.name ?? 'No store yet'}</div>
          <div className="flex items-center gap-4">
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
        <main className="flex-1 p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
