import { useEffect, useState } from 'react'
import { Link, Outlet, useParams } from 'react-router-dom'
import { CartProvider, useCart } from '../../context/CartContext'
import { StoreContext } from '../../context/StoreContext'
import { Spinner } from '../../components/ui/Spinner'
import { storefrontApi } from '../../lib/storefrontApi'
import type { StoreProfile } from '../../types/commerce'

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
        <span className="min-w-5 rounded-full bg-brand px-1.5 py-0.5 text-center text-[11px] font-bold text-white">
          {itemCount}
        </span>
      )}
    </Link>
  )
}

/** Header and store loading shared by every storefront page under /store/:storeId. */
export function StorefrontLayout() {
  const { storeId = '' } = useParams()
  const [store, setStore] = useState<StoreProfile | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false
    setStore(null)
    setNotFound(false)
    storefrontApi
      .getStore(storeId)
      .then((s) => !cancelled && setStore(s))
      .catch(() => !cancelled && setNotFound(true))
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
        <div className="min-h-screen bg-bg">
          <header className="border-b border-border bg-white">
            <div className="mx-auto flex h-[72px] max-w-[1120px] items-center justify-between px-4 sm:px-10">
              <Link to={`/store/${store.id}`} className="font-display text-xl font-bold text-text">
                {store.name}
              </Link>
              <CartLink storeId={store.id} />
            </div>
          </header>
          <main className="mx-auto max-w-[1120px] px-4 py-8 sm:px-10">
            <Outlet />
          </main>
        </div>
      </CartProvider>
    </StoreContext.Provider>
  )
}
