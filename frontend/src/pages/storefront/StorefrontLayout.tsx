import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useParams } from 'react-router-dom'
import { CartProvider, useCart } from '../../context/CartContext'
import { useAuth } from '../../context/AuthContext'
import { StoreContext } from '../../context/StoreContext'
import { Spinner } from '../../components/ui/Spinner'
import { SearchBox } from '../../components/storefront/SearchBox'
import { AssistantWidget } from '../../components/storefront/AssistantWidget'
import { catalogApi } from '../../lib/shopApi'
import { storefrontApi } from '../../lib/storefrontApi'
import type { StoreProfile } from '../../types/commerce'
import type { CategoryCount } from '../../types/shop'

function CartLink({ storeId }: { storeId: string }) {
  const { itemCount } = useCart()
  return (
    <Link
      to={`/store/${storeId}/cart`}
      aria-label={`Cart, ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}
      className="relative inline-flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm font-semibold text-text hover:bg-bg"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M6 8h12l-1 12H7L6 8z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </svg>
      Cart
      {itemCount > 0 && (
        <span className="min-w-5 rounded-full bg-brand px-1.5 py-0.5 text-center text-[11px] font-bold text-white">{itemCount}</span>
      )}
    </Link>
  )
}

function AccountLink({ storeId }: { storeId: string }) {
  const { isAuthenticated, isLoading, user } = useAuth()
  if (isLoading) return null
  return isAuthenticated ? (
    <Link to={`/store/${storeId}/account`} className="rounded-[10px] px-3 py-2 text-sm font-semibold text-text hover:bg-bg">
      {user?.name?.split(' ')[0] ?? 'Account'}
    </Link>
  ) : (
    <Link to={`/store/${storeId}/account/login`} className="rounded-[10px] px-3 py-2 text-sm font-semibold text-text hover:bg-bg">
      Sign in
    </Link>
  )
}

/** Category links: the one being browsed (from the address) is marked as the current page. */
function CategoryNav({ storeId, categories }: { storeId: string; categories: CategoryCount[] }) {
  const { pathname, search } = useLocation()
  const onCatalog = pathname === `/store/${storeId}/products`
  const current = onCatalog ? new URLSearchParams(search).get('category') : null
  const isAll = onCatalog && !current && !new URLSearchParams(search).get('q')
  const link = (active: boolean) =>
    `whitespace-nowrap rounded-[10px] px-3 py-1.5 text-sm font-medium ${active ? 'bg-brand-soft text-brand' : 'text-text-secondary hover:text-text'}`
  return (
    <nav aria-label="Categories" className="border-t border-border">
      <ul className="mx-auto flex max-w-[1120px] gap-1 overflow-x-auto px-4 py-2 sm:px-10">
        <li>
          <Link to={`/store/${storeId}/products`} aria-current={isAll ? 'page' : undefined} className={link(isAll)}>
            All products
          </Link>
        </li>
        {categories.slice(0, 8).map((c) => (
          <li key={c.name}>
            <Link
              to={`/store/${storeId}/products?category=${encodeURIComponent(c.name)}`}
              aria-current={current === c.name ? 'page' : undefined}
              className={link(current === c.name)}
            >
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** Header, category navigation, search and footer shared by every storefront page under /store/:storeId. */
export function StorefrontLayout() {
  const { storeId = '' } = useParams()
  const [store, setStore] = useState<StoreProfile | null>(null)
  const [categories, setCategories] = useState<CategoryCount[]>([])
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false
    setStore(null)
    setNotFound(false)
    storefrontApi
      .getStore(storeId)
      .then((s) => !cancelled && setStore(s))
      .catch(() => !cancelled && setNotFound(true))
    catalogApi
      .categories(storeId)
      .then((c) => !cancelled && setCategories(c))
      .catch(() => !cancelled && setCategories([]))
    return () => {
      cancelled = true
    }
  }, [storeId])

  if (notFound) {
    return (
      <main className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="font-display text-xl font-bold">Store not found</h1>
        <p className="mt-2 text-sm text-text-secondary">Check the link you were given and try again.</p>
      </main>
    )
  }

  if (!store) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading store" />
      </div>
    )
  }

  return (
    <StoreContext.Provider value={store}>
      <CartProvider storeId={store.id}>
        <div className="flex min-h-screen flex-col bg-bg">
          <header className="border-b border-border bg-white">
            <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-10">
              <Link to={`/store/${store.id}`} className="font-display text-xl font-bold text-text">
                {store.name}
              </Link>
              <div className="order-last w-full sm:order-none sm:max-w-md sm:flex-1">
                <SearchBox storeId={store.id} />
              </div>
              <div className="ml-auto flex items-center gap-1">
                <AccountLink storeId={store.id} />
                <CartLink storeId={store.id} />
              </div>
            </div>
            {categories.length > 0 && <CategoryNav storeId={store.id} categories={categories} />}
          </header>
          <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-8 sm:px-10">
            <Outlet context={{ categories }} />
          </main>
          <footer className="border-t border-border bg-white">
            <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-text-secondary sm:px-10">
              <span>{store.name}, powered by ZYRO</span>
              <span>Secure checkout by Stripe</span>
            </div>
          </footer>
          <AssistantWidget storeId={store.id} currency={store.currency} />
        </div>
      </CartProvider>
    </StoreContext.Provider>
  )
}
