import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useStore } from '../../context/StoreContext'
import { Alert } from '../../components/ui/Alert'
import { ProductCard } from '../../components/storefront/ProductCard'
import { ProductGridSkeleton } from '../../components/storefront/ProductGridSkeleton'
import { errorMessage } from '../../lib/ordersApi'
import { catalogApi } from '../../lib/shopApi'
import { useAddToCart } from '../../lib/useAddToCart'
import type { Product } from '../../types/api'
import type { CategoryCount } from '../../types/shop'

/** The store's front page: the newest products and a way into each category. */
export function StorefrontHome() {
  const store = useStore()
  const { categories } = useOutletContext<{ categories: CategoryCount[] }>()
  const { addingId, message, addToCart } = useAddToCart()
  const [products, setProducts] = useState<Product[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    catalogApi
      .list(store.id, { sort: 'newest', limit: 8 })
      .then((r) => !cancelled && setProducts(r.data))
      .catch((e) => !cancelled && setLoadError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [store.id])

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="home-heading" className="flex flex-col items-start gap-4 rounded-2xl border border-border bg-white px-6 py-10 sm:px-10">
        <h1 id="home-heading" className="font-display text-3xl font-bold sm:text-4xl">
          {store.name}
        </h1>
        <p className="max-w-xl text-sm text-text-secondary">Browse the latest arrivals or jump straight to a category. Checkout is secure and you do not need an account to buy.</p>
        <Link to={`/store/${store.id}/products`} className="inline-flex h-11 items-center rounded-[10px] bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-hover">
          Shop all products
        </Link>
      </section>

      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {loadError && <Alert>{loadError}</Alert>}

      <section aria-labelledby="new-heading" className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 id="new-heading" className="font-display text-xl font-bold">
            New arrivals
          </h2>
          <Link to={`/store/${store.id}/products`} className="text-sm font-semibold text-brand hover:text-brand-hover">
            See all
          </Link>
        </div>
        {products === null && !loadError && <ProductGridSkeleton count={4} />}
        {products?.length === 0 && (
          <p className="rounded-2xl border border-border bg-white px-6 py-12 text-center text-sm text-text-secondary">This store has no products yet. Please check back soon.</p>
        )}
        <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {products?.map((p) => (
            <ProductCard key={p.id} product={p} storeId={store.id} currency={store.currency} adding={addingId === p.id} onAdd={(x) => void addToCart(x)} />
          ))}
        </ul>
      </section>

      {categories.length > 0 && (
        <section aria-labelledby="cat-heading" className="flex flex-col gap-4">
          <h2 id="cat-heading" className="font-display text-xl font-bold">
            Shop by category
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {categories.map((c) => (
              <li key={c.name}>
                <Link
                  to={`/store/${store.id}/products?category=${encodeURIComponent(c.name)}`}
                  className="flex h-full flex-col gap-1 rounded-2xl border border-border bg-white p-4 hover:border-brand"
                >
                  <span className="text-sm font-semibold">{c.name}</span>
                  <span className="text-xs text-text-secondary">
                    {c.count} {c.count === 1 ? 'product' : 'products'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
