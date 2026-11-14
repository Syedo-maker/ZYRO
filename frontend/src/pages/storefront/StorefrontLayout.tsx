import { ShoppingBag } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link, Outlet, useLocation, useParams } from 'react-router-dom'
import { CartProvider, useCart } from '../../context/CartContext'
import { useAuth } from '../../context/AuthContext'
import { StoreContext } from '../../context/StoreContext'
import { Spinner } from '../../components/ui/Spinner'
import { SearchBox } from '../../components/storefront/SearchBox'
import { AssistantWidget } from '../../components/storefront/AssistantWidget'
import { ThemeToggle } from '../../components/ui/ThemeToggle'
import { useTheme } from '../../context/themeContext'
import { catalogApi } from '../../lib/shopApi'
import { brandStyle } from '../../lib/brandTheme'
import { readCachedTokens, themeStyle, writeCachedTokens, type StoreTheme } from '../../lib/storeTheme'
import { loadThemeFont } from '../../lib/themeFonts'
import { isStudioPreview, PREVIEW_READY, readPreviewMessage } from '../../lib/themePreview'
import type { PublishedTheme } from '../../lib/storeTheme'
import { storefrontApi } from '../../lib/storefrontApi'
import type { StoreProfile } from '../../types/commerce'
import type { CategoryCount } from '../../types/shop'

function CartLink({ storeId }: { storeId: string }) {
  const { itemCount } = useCart()
  return (
    <Link
      to={`/store/${storeId}/cart`}
      aria-label={`Cart, ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}
      className="relative inline-flex items-center gap-2 rounded-control px-3 py-2 text-sm font-semibold text-text hover:bg-bg"
    >
      <ShoppingBag aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
      Cart
      {itemCount > 0 && (
        <span className="min-w-5 rounded-full bg-brand px-1.5 py-0.5 text-center text-[11px] font-bold text-on-brand">{itemCount}</span>
      )}
    </Link>
  )
}

function AccountLink({ storeId }: { storeId: string }) {
  const { isAuthenticated, isLoading, user } = useAuth()
  if (isLoading) return null
  return isAuthenticated ? (
    <Link to={`/store/${storeId}/account`} className="rounded-control px-3 py-2 text-sm font-semibold text-text hover:bg-bg">
      {user?.name?.split(' ')[0] ?? 'Account'}
    </Link>
  ) : (
    <Link to={`/store/${storeId}/account/login`} className="rounded-control px-3 py-2 text-sm font-semibold text-text hover:bg-bg">
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
    `whitespace-nowrap rounded-control px-3 py-1.5 text-sm font-medium ${active ? 'bg-brand-soft text-brand-ink' : 'text-text-secondary hover:text-text'}`
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

/** Takes every design token off <html>: only a shop's theme puts them there (here, or public/theme-init.js). */
function clearDocumentTheme(root: HTMLElement) {
  const names: string[] = []
  for (let i = 0; i < root.style.length; i++) if (root.style[i].startsWith('--')) names.push(root.style[i])
  for (const n of names) root.style.removeProperty(n)
  // Back to the visitor's own Dark or Light, as public/theme-init.js set it.
  root.style.colorScheme = root.getAttribute('data-theme') ?? ''
}

/**
 * The shop's theme on <html> as well as on the shop's root, while the shop is on screen: toasts and
 * dialogs render outside the root, and the page behind an overscroll is <html>'s. Set before paint;
 * replaces whatever the before-paint script took from this browser's cache, and clears it when the
 * shop turns out to have no theme; taken off again when the shopper leaves for the platform.
 */
function useDocumentTheme(style: CSSProperties | undefined) {
  useLayoutEffect(() => {
    const root = document.documentElement
    clearDocumentTheme(root)
    if (!style) return
    const values = style as Record<string, string>
    for (const n of Object.keys(values).filter((k) => k.startsWith('--'))) root.style.setProperty(n, values[n])
    if (style.colorScheme) root.style.colorScheme = String(style.colorScheme)
    return () => clearDocumentTheme(root)
  }, [style])
}

/** The footer the owner chose: simple (the default), detailed (with links and their about text) or minimal. */
function StoreFooter({ store, footer, themed }: { store: { id: string; name: string; description?: string | null; cardPayments?: boolean }; footer: StoreTheme['footerStyle']; themed: boolean }) {
  const legal = (
    <span className="flex flex-wrap gap-x-4">
      {/* Only when card payment is really offered: a cash-on-delivery-only shop must not claim it. */}
      {store.cardPayments && <span>Secure checkout by Stripe</span>}
      <Link to={`/store/${store.id}/policies`} className="underline underline-offset-2 hover:text-text">Shop policies</Link>
      <Link to="/privacy" className="underline underline-offset-2 hover:text-text">Privacy</Link>
      <Link to="/terms" className="underline underline-offset-2 hover:text-text">Terms</Link>
    </span>
  )
  if (footer === 'minimal') {
    return (
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-3 px-4 py-4 text-xs text-text-muted sm:px-10">
          <span>{store.name}, powered by ZYRO</span>
          {legal}
        </div>
      </footer>
    )
  }
  if (footer === 'detailed') {
    return (
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto grid max-w-[1120px] gap-8 px-4 py-10 text-sm sm:grid-cols-3 sm:px-10">
          <div className="flex flex-col gap-2">
            <span className="font-display text-base font-bold text-text">{store.name}</span>
            {store.description && <p className="text-text-secondary">{store.description}</p>}
          </div>
          <nav aria-label="Shop" className="flex flex-col gap-2 text-text-secondary">
            <Link to={`/store/${store.id}/products`} className="hover:text-text">All products</Link>
            <Link to={`/store/${store.id}/cart`} className="hover:text-text">Cart</Link>
            <Link to={`/store/${store.id}/account`} className="hover:text-text">My account</Link>
            <Link to="/shop" className="hover:text-text">All shops</Link>
          </nav>
          <div className="flex flex-col gap-2 text-xs text-text-secondary">
            {!themed && <ThemeToggle />}
            <span>Powered by ZYRO</span>
            {legal}
          </div>
        </div>
      </footer>
    )
  }
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-text-secondary sm:px-10">
        <span className="flex items-center gap-3">
          {/* A themed shop has one look, chosen by its owner, so the visitor's Dark/Light switch is not offered. */}
          {!themed && <ThemeToggle />}
          {store.name}, powered by ZYRO
        </span>
        {legal}
      </div>
    </footer>
  )
}

/** Header, category navigation, search and footer shared by every storefront page under /store/:storeId. */
export function StorefrontLayout() {
  const { theme } = useTheme()
  const { storeId = '' } = useParams()
  const [store, setStore] = useState<StoreProfile | null>(null)
  const [categories, setCategories] = useState<CategoryCount[]>([])
  const [notFound, setNotFound] = useState(false)
  // The colours this browser last saw this shop in, so the loading screen does not flash Zyro's.
  const [cachedStyle] = useState(() => {
    const tokens = readCachedTokens(storeId)
    return tokens ? themeStyle(tokens) : undefined
  })
  // Inside the owner's Theme Studio, the draft arrives by message from the Studio window
  // (lib/themePreview.ts); everywhere else this stays null and the published theme is used.
  const [inPreview] = useState(() => isStudioPreview())
  const [previewTheme, setPreviewTheme] = useState<PublishedTheme | null>(null)

  useEffect(() => {
    if (!inPreview) return
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin) return
      const next = readPreviewMessage(event.data)
      if (!next) return
      loadThemeFont(next.theme.font)
      setPreviewTheme(next)
    }
    window.addEventListener('message', onMessage)
    window.parent.postMessage({ type: PREVIEW_READY, path: window.location.pathname }, window.location.origin)
    return () => window.removeEventListener('message', onMessage)
  }, [inPreview])

  useEffect(() => {
    let cancelled = false
    setStore(null)
    setNotFound(false)
    storefrontApi
      .getStore(storeId)
      .then((s) => {
        if (cancelled) return
        if (!inPreview) writeCachedTokens(storeId, s.theme?.tokens ?? null)
        loadThemeFont(s.theme?.theme.font)
        setStore(s)
      })
      .catch(() => !cancelled && setNotFound(true))
    catalogApi
      .categories(storeId)
      .then((c) => !cancelled && setCategories(c))
      .catch(() => !cancelled && setCategories([]))
    return () => {
      cancelled = true
    }
  }, [storeId, inPreview])

  const published = previewTheme ?? store?.theme ?? null
  const shownStore = useMemo(() => (store && previewTheme ? { ...store, theme: previewTheme } : store), [store, previewTheme])
  const themedStyle = useMemo(() => (published ? themeStyle(published.tokens) : undefined), [published])
  const rootStyle = store ? (themedStyle ?? brandStyle(store.themeColor, theme)) : cachedStyle
  useDocumentTheme(store ? themedStyle : cachedStyle)

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
      <div className="flex min-h-screen items-center justify-center bg-bg text-text" style={rootStyle}>
        <Spinner label="Loading store" />
      </div>
    )
  }

  return (
    <StoreContext.Provider value={shownStore ?? store}>
      <CartProvider storeId={store.id}>
        {/* The shop wears its merchant's colour from here down (lib/brandTheme.ts); the platform keeps ZYRO's. */}
        {/* A published store theme (lib/storeTheme.ts) when there is one: the shop's own colours, fonts
            and shapes, through the same tokens. */}
        <div className="flex min-h-screen flex-col bg-bg text-text" style={rootStyle}>
          <header className="border-b border-border bg-surface">
            <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-10">
              <Link to={`/store/${store.id}`} className="flex items-center gap-3 font-display text-xl font-bold text-text">
                {(published?.theme.logoUrl ?? store.logoUrl) && (
                  <img src={published?.theme.logoUrl ?? store.logoUrl ?? undefined} alt="" className="h-9 w-9 rounded-md object-cover" />
                )}
                {store.name}
              </Link>
              <div className="order-last w-full sm:order-none sm:max-w-md sm:flex-1">
                <SearchBox storeId={store.id} />
              </div>
              <div className="ml-auto flex items-center gap-1">
                {/* Issue 2: the way back out of this shop. Each shop is its own tenant with its own
                    basket, so this leaves the shop rather than carrying anything across. */}
                <Link to="/shop" className="rounded-control px-3 py-2 text-sm font-semibold text-text hover:bg-bg">
                  All shops
                </Link>
                <AccountLink storeId={store.id} />
                <CartLink storeId={store.id} />
              </div>
            </div>
            {categories.length > 0 && <CategoryNav storeId={store.id} categories={categories} />}
          </header>
          <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-8 sm:px-10">
            <Outlet context={{ categories }} />
          </main>
          <StoreFooter store={store} footer={published?.theme.footerStyle ?? 'simple'} themed={!!published} />
          <AssistantWidget storeId={store.id} currency={store.currency} />
        </div>
      </CartProvider>
    </StoreContext.Provider>
  )
}
