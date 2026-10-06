import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Alert } from '../../components/ui/Alert'
import { Input } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import { directoryApi } from '../../lib/directoryApi'
import { errorMessage } from '../../lib/ordersApi'
import type { DirectoryStore } from '../../types/directory'

/**
 * The shopper's front page (Issue 2): every shop that has opted in and has a real catalogue.
 *
 * This is where multi-tenancy becomes visible to a shopper. There is no single shared catalogue:
 * each shop is its own tenant with its own products, prices, currency, delivery and basket. Picking
 * a shop here opens its storefront at /store/:storeId, and everything from that point on belongs to
 * that one shop. A basket does not follow the shopper from one shop to the next, for the same
 * reason a trolley does not move between two different shops on a high street.
 */
export function ShopDirectoryPage() {
  const [stores, setStores] = useState<DirectoryStore[] | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    directoryApi
      .categories()
      .then((r) => setCategories(r.categories))
      .catch(() => setCategories([]))
  }, [])

  useEffect(() => {
    let cancelled = false
    setStores(null)
    setLoadError(null)
    directoryApi
      .list({ q: submitted || undefined, category: category || undefined })
      .then((r) => !cancelled && setStores(r.stores))
      .catch((e) => !cancelled && setLoadError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [submitted, category])

  function search(e: FormEvent) {
    e.preventDefault()
    setSubmitted(query.trim())
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4 lg:px-8">
          <Link to="/" className="font-display text-xl font-bold">
            ZYRO
          </Link>
          <Link to="/register" className="text-sm font-semibold text-brand hover:text-brand-hover">
            Open your own store
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10 lg:px-8">
        <section className="flex flex-col gap-4">
          <h1 className="font-display text-3xl font-bold">Shops on ZYRO</h1>
          <p className="max-w-xl text-sm text-text-secondary">
            Each shop has its own products and its own basket. Open one to browse and buy.
          </p>

          <form onSubmit={search} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <Input id="directory-search" label="Search shops" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Shop name" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="directory-category" className="text-sm font-medium">
                Category
              </label>
              <select
                id="directory-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-11 rounded-[10px] border border-border bg-white px-3 text-sm"
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="inline-flex h-11 items-center rounded-[10px] bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-hover">
              Search
            </button>
          </form>
        </section>

        {loadError && <Alert>{loadError}</Alert>}

        {stores === null && !loadError && (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        )}

        {stores !== null && stores.length === 0 && (
          <div role="status" className="rounded-2xl border border-border bg-white px-6 py-12 text-center">
            <h2 className="font-display text-lg font-semibold">No shops to show yet</h2>
            <p className="mt-2 text-sm text-text-secondary">
              {submitted || category
                ? 'Nothing matched that. Try a different name or category.'
                : 'Shops appear here once they have a few products on sale.'}
            </p>
          </div>
        )}

        {stores !== null && stores.length > 0 && (
          <ul role="list" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stores.map((store) => (
              <li key={store.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-5">
                <div className="flex items-center gap-3">
                  {store.logoUrl ? (
                    <img src={store.logoUrl} alt="" className="h-10 w-10 rounded-[10px] object-cover" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-10 w-10 items-center justify-center rounded-[10px] text-sm font-bold text-white"
                      style={{ backgroundColor: store.themeColor ?? '#4F46E5' }}
                    >
                      {store.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">{store.name}</h2>
                    {store.category && <p className="truncate text-xs text-text-secondary">{store.category}</p>}
                  </div>
                </div>

                {store.description && <p className="line-clamp-3 flex-1 text-sm text-text-secondary">{store.description}</p>}

                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-text-secondary">
                    {store.productCount} {store.productCount === 1 ? 'product' : 'products'}
                  </span>
                  <Link to={`/store/${store.id}`} className="text-sm font-semibold text-brand hover:text-brand-hover">
                    Visit shop
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
