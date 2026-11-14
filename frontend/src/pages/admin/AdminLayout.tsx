import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import {
  CreditCard,
  LayoutDashboard,
  Megaphone,
  Menu,
  Mic,
  Package,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Star,
  Tags,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Wordmark } from '../../components/ui/Wordmark'
import { ThemeToggle } from '../../components/ui/ThemeToggle'
import { useAuth } from '../../context/AuthContext'
import { can, type StorePermission } from '../../lib/permissions'

interface NavItem {
  label: string
  to: string
  enabled: boolean
  icon: LucideIcon
  /** Shown only to someone with this permission in the store (the page would only refuse them). */
  needs?: StorePermission
}

// Matches the sidebar in design/wireframes/AdminDashboard.dc.html / AdminCatalog.dc.html.
// Products (Phase 1) and Orders (Phase 2) are functional; the rest light up in the phases
// that build their backend (Dashboard and Marketing: Phase 3, per Implementation_Plan.md).
const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/admin/dashboard', enabled: true, icon: LayoutDashboard },
  { label: 'Products', to: '/admin/products', enabled: true, icon: Package },
  { label: 'Categories', to: '/admin/categories', enabled: true, icon: Tags, needs: 'products_write' },
  { label: 'Orders', to: '/admin/orders', enabled: true, icon: ShoppingBag },
  { label: 'Payments', to: '/admin/payments', enabled: true, icon: Wallet },
  { label: 'Voice notes', to: '/admin/voice-notes', enabled: true, icon: Mic },
  { label: 'Team & register', to: '/admin/team', enabled: true, icon: Users },
  { label: 'Reviews', to: '/admin/reviews', enabled: true, icon: Star },
  { label: 'Marketing', to: '/admin/marketing', enabled: true, icon: Megaphone },
]

/** Only the store owner spends money or changes the store's settings, and only a platform operator sees the platform view. */
const OWNER_ITEMS: NavItem[] = [
  { label: 'Plan & billing', to: '/admin/billing', enabled: true, icon: CreditCard },
  { label: 'Settings', to: '/admin/settings', enabled: true, icon: Settings },
]
const PLATFORM_ITEM: NavItem = { label: 'Platform', to: '/admin/platform', enabled: true, icon: ShieldCheck }

const ICON = 'h-[18px] w-[18px] shrink-0'
const HEADER_LINK = 'text-sm font-semibold text-text-secondary transition-colors duration-150 hover:text-text'

export function AdminLayout() {
  const { isLoading, isAuthenticated, stores, activeStore, user, logout } = useAuth()
  // On a phone or tablet the sidebar is a drawer; it closes on every navigation and on Escape.
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  // Closing the drawer when the page changes is syncing it with the router, an outside system.
  useEffect(() => setMenuOpen(false), [location.pathname])
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  if (isLoading) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />
  // Issue 2: being signed in is not the same as having a shop. A shopper has no shop to manage, and
  // every panel here would show them an error, so they are sent to the shopper side instead. This
  // is only about not showing somebody a useless screen: the server refuses them either way, which
  // is what actually keeps a shop's data safe (requireOwner / requirePermission, per request).
  if (stores.length === 0) return <Navigate to="/shop" replace />

  const items = [
    ...NAV_ITEMS.filter((i) => i.enabled && (!i.needs || can(activeStore, i.needs))),
    ...(activeStore?.role === 'owner' ? OWNER_ITEMS : []),
    ...(user?.platformAdmin ? [PLATFORM_ITEM] : []),
    ...NAV_ITEMS.filter((i) => !i.enabled),
  ]

  return (
    <div className="min-h-screen bg-bg lg:flex">
      {/* The drawer's backdrop, on a phone or tablet only. */}
      {menuOpen && <div aria-hidden="true" onClick={() => setMenuOpen(false)} className="fixed inset-0 z-[var(--z-drawer)] bg-bg/70 backdrop-blur-sm lg:hidden" />}

      <aside
        id="admin-sidebar"
        className={`fixed inset-y-0 left-0 z-[var(--z-drawer)] flex w-[248px] flex-col gap-1 overflow-y-auto border-r border-border bg-inverse p-4 transition-transform duration-200 ease-standard lg:sticky lg:top-0 lg:h-screen lg:w-[232px] lg:shrink-0 lg:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-3 pb-6 pt-1">
          <Wordmark className="text-xl text-on-inverse" />
          <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu" className="grid h-11 w-11 place-items-center rounded-full text-on-inverse-secondary hover:bg-on-inverse/5 hover:text-on-inverse lg:hidden">
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        {items.map((item) =>
          item.enabled ? (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `group relative flex min-h-11 items-center gap-3 whitespace-nowrap rounded-control px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
                  isActive
                    ? 'bg-brand-soft font-semibold text-on-inverse before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand'
                    : 'text-on-inverse-secondary hover:bg-on-inverse/5 hover:text-on-inverse'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon aria-hidden="true" className={`${ICON} ${isActive ? 'text-brand-ink' : 'text-on-inverse-muted group-hover:text-on-inverse'}`} strokeWidth={1.75} />
                  {item.label}
                </>
              )}
            </NavLink>
          ) : (
            <span
              key={item.to}
              title="Not available on your plan yet"
              className="flex min-h-11 cursor-not-allowed items-center gap-3 whitespace-nowrap rounded-control px-3 py-2.5 text-sm font-medium text-on-inverse-muted opacity-60"
            >
              <item.icon aria-hidden="true" className={ICON} strokeWidth={1.75} />
              {item.label}
            </span>
          )
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-[var(--z-sticky)] flex min-h-[68px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-bg/85 px-4 py-3 backdrop-blur-md lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              aria-expanded={menuOpen}
              aria-controls="admin-sidebar"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border text-text hover:border-text/40 lg:hidden"
            >
              <Menu aria-hidden="true" className="h-5 w-5" />
            </button>
            <div className="truncate text-[17px] font-semibold">{activeStore?.name ?? 'No store yet'}</div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {activeStore && (
              <a href={`/pos/${activeStore.id}`} target="_blank" rel="noreferrer" className={HEADER_LINK}>
                Open register
              </a>
            )}
            {activeStore && (
              <a href={`/store/${activeStore.id}`} target="_blank" rel="noreferrer" className={HEADER_LINK}>
                View storefront
              </a>
            )}
            {/* Issue 2: one way across to the shopper side, for an owner who also buys things. */}
            <Link to="/shop" className={HEADER_LINK}>
              Browse shops
            </Link>
            <ThemeToggle />
            <span className="text-sm text-text-muted">{user?.email}</span>
            <button onClick={() => void logout()} className={HEADER_LINK}>
              Log out
            </button>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
