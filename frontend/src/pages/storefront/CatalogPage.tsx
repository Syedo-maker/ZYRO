import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'
import { useStore } from '../../context/StoreContext'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Pagination } from '../../components/Pagination'
import { ProductCard } from '../../components/storefront/ProductCard'
import { ProductGridSkeleton } from '../../components/storefront/ProductGridSkeleton'
import { errorMessage } from '../../lib/ordersApi'
import { catalogApi } from '../../lib/shopApi'
import { useAddToCart } from '../../lib/useAddToCart'
import type { Product } from '../../types/api'
import type { CategoryCount, ProductSort } from '../../types/shop'

const PAGE_SIZE = 12

const SORT_LABELS: Record<ProductSort, string> = {
  relevance: 'Most relevant',
  newest: 'Newest',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  title: 'Name: A to Z',
}

/**
 * Browse and search. Everything the shopper chooses (search words, category, price, in stock,
 * sort, page) lives in the address, so a result page can be bookmarked, shared and reached with
 * the back button.
 */
export function CatalogPage() {
  const store = useStore()
  const { categories } = useOutletContext<{ categories: CategoryCount[] }>()
  const [params, setParams] = useSearchParams()
  const { addingId, message, addToCart } = useAddToCart()
  const [result, setResult] = useState<{ products: Product[]; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // True while a new page of results is loading; the previous results stay on screen (dimmed) instead of blanking.
  const [loading, setLoading] = useState(true)

  const q = params.get('q') ?? ''
  const category = params.get('category') ?? ''
  const minPrice = params.get('minPrice') ?? ''
  const maxPrice = params.get('maxPrice') ?? ''
  const inStock = params.get('inStock') === 'true'
  const sort = (params.get('sort') as ProductSort | null) ?? (q ? 'relevance' : 'newest')
  const page = Math.max(1, Number(params.get('page')) || 1)
  const filtered = Boolean(category || minPrice || maxPrice || inStock)

  const key = params.toString()
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    catalogApi
      .list(store.id, {
        q: q || undefined,
        category: category || undefined,
        minPrice: minPrice ? Number(minPrice) : undefined,
        maxPrice: maxPrice ? Number(maxPrice) : undefined,
        inStock,
        sort,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      .then((r) => !cancelled && setResult({ products: r.data, total: r.pagination.total }))
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // key stands for every parameter read above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id, key])

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    if (!('page' in changes)) next.delete('page')
    setParams(next)
  }

  function applyPrice(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    update({
      minPrice: String(data.get('minPrice') ?? '').trim() || null,
      maxPrice: String(data.get('maxPrice') ?? '').trim() || null,
      inStock: data.get('inStock') ? 'true' : null,
    })
  }

  const hrefForPage = useMemo(
    () => (p: number) => {
      const next = new URLSearchParams(params)
      if (p <= 1) next.delete('page')
      else next.set('page', String(p))
      return `/store/${store.id}/products?${next.toString()}`
    },
    [params, store.id]
  )

  const heading = q ? `Results for "${q}"` : category || 'All products'
  const pageCount = result ? Math.ceil(result.total / PAGE_SIZE) : 0
  const sorts = (q ? ['relevance', 'newest', 'price_asc', 'price_desc', 'title'] : ['newest', 'price_asc', 'price_desc', 'title']) as ProductSort[]

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-xs text-text-secondary">
        <Link to={`/store/${store.id}`} className="hover:text-text">
          Home
        </Link>
        <span aria-hidden="true"> / </span>
        <span>{category || (q ? 'Search' : 'All products')}</span>
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">{heading}</h1>
          <p className="mt-1 text-sm text-text-secondary" role="status" aria-live="polite">
            {result ? `${result.total} ${result.total === 1 ? 'result' : 'results'}` : 'Loading...'}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="sort" className="text-xs font-semibold text-text-secondary">
            Sort by
          </label>
          <select
            id="sort"
            value={sorts.includes(sort) ? sort : sorts[0]}
            onChange={(e) => update({ sort: e.target.value })}
            className="h-11 rounded-[10px] border border-border bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          >
            {sorts.map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <details className="rounded-2xl border border-border bg-white lg:w-60 lg:shrink-0 lg:[&>summary]:hidden" open={typeof window !== 'undefined' && window.innerWidth >= 1024}>
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Filters{filtered ? ' (active)' : ''}</summary>
          <div className="flex flex-col gap-6 px-4 pb-4 pt-1 lg:pt-4">
            {categories.length > 0 && (
              <section aria-labelledby="filter-cat">
                <h2 id="filter-cat" className="mb-2 text-xs font-bold text-text-secondary">
                  Category
                </h2>
                <ul className="flex flex-col gap-1">
                  <li>
                    <button
                      onClick={() => update({ category: null })}
                      aria-pressed={!category}
                      className={`w-full rounded-lg px-2.5 py-1.5 text-left text-sm ${!category ? 'bg-brand-soft font-semibold text-brand' : 'hover:bg-bg'}`}
                    >
                      All
                    </button>
                  </li>
                  {categories.map((c) => (
                    <li key={c.name}>
                      <button
                        onClick={() => update({ category: c.name })}
                        aria-pressed={category === c.name}
                        className={`flex w-full justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${category === c.name ? 'bg-brand-soft font-semibold text-brand' : 'hover:bg-bg'}`}
                      >
                        <span>{c.name}</span>
                        <span className="text-text-secondary">{c.count}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <form key={`${minPrice}|${maxPrice}|${inStock}`} onSubmit={applyPrice} className="flex flex-col gap-3" aria-label="Price and availability">
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-xs font-bold text-text-secondary">Price ({store.currency})</legend>
                <div className="flex items-center gap-2">
                  <label className="sr-only" htmlFor="minPrice">
                    Minimum price
                  </label>
                  <input id="minPrice" name="minPrice" type="number" min="0" step="0.01" inputMode="decimal" placeholder="Min" defaultValue={minPrice} className="h-10 w-full rounded-[10px] border border-border px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30" />
                  <span aria-hidden="true">-</span>
                  <label className="sr-only" htmlFor="maxPrice">
                    Maximum price
                  </label>
                  <input id="maxPrice" name="maxPrice" type="number" min="0" step="0.01" inputMode="decimal" placeholder="Max" defaultValue={maxPrice} className="h-10 w-full rounded-[10px] border border-border px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30" />
                </div>
              </fieldset>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="inStock" defaultChecked={inStock} className="h-4 w-4 accent-brand" />
                In stock only
              </label>
              <Button type="submit" variant="secondary" className="h-10">
                Apply
              </Button>
            </form>

            {(filtered || q) && (
              <Link to={`/store/${store.id}/products`} className="text-sm font-semibold text-brand hover:text-brand-hover">
                Clear search and filters
              </Link>
            )}
          </div>
        </details>

        <div className={`flex min-w-0 flex-1 flex-col gap-6 transition-opacity ${loading && result ? 'opacity-60' : ''}`} aria-busy={loading}>
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
          {error && <Alert>{error}</Alert>}
          {result === null && !error && <ProductGridSkeleton count={PAGE_SIZE} />}
          {result?.products.length === 0 && (
            <div className="rounded-2xl border border-border bg-white px-6 py-12 text-center">
              <h2 className="font-display text-base font-bold">Nothing found</h2>
              <p className="mt-1 text-sm text-text-secondary">{q ? `No products match "${q}"` : 'No products match these filters'}. Try a shorter word or fewer filters.</p>
              <Link to={`/store/${store.id}/products`} className="mt-4 inline-block text-sm font-semibold text-brand">
                Show all products
              </Link>
            </div>
          )}
          {result && result.products.length > 0 && (
            <ul className="grid grid-cols-2 gap-4 xl:grid-cols-3">
              {result.products.map((p) => (
                <ProductCard key={p.id} product={p} storeId={store.id} currency={store.currency} adding={addingId === p.id} onAdd={(x) => void addToCart(x)} />
              ))}
            </ul>
          )}
          <Pagination page={page} pageCount={pageCount} hrefFor={hrefForPage} />
        </div>
      </div>
    </div>
  )
}
