import { Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { buttonStyles } from '../../components/ui/Button'
import { useStore } from '../../context/StoreContext'
import { Alert } from '../../components/ui/Alert'
import { ProductCard } from '../../components/storefront/ProductCard'
import { ProductGridSkeleton } from '../../components/storefront/ProductGridSkeleton'
import { RecommendationsSection } from '../../components/storefront/RecommendationsSection'
import { lastViewed } from '../../lib/recentlyViewed'
import { errorMessage } from '../../lib/ordersApi'
import { catalogApi } from '../../lib/shopApi'
import { storefrontApi } from '../../lib/storefrontApi'
import { visibleSections, type SectionId } from '../../lib/storeTheme'
import { useAddToCart } from '../../lib/useAddToCart'
import type { Product } from '../../types/api'
import type { CategoryCount, Review } from '../../types/shop'

// A shop without a published theme keeps exactly the front page it always had.
const DEFAULT_SECTIONS: SectionId[] = ['hero', 'featured', 'categories']

/**
 * The store's front page. With a published theme (Store Themes), the owner chooses which sections
 * appear and in what order, the hero's words and banner, and an about text; all of it is plain text
 * rendered by React, never HTML.
 */
export function StorefrontHome() {
  const store = useStore()
  const theme = store.theme?.theme ?? null
  const { categories } = useOutletContext<{ categories: CategoryCount[] }>()
  const { addingId, message, addToCart } = useAddToCart()
  const [products, setProducts] = useState<Product[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reviews, setReviews] = useState<(Review & { productTitle: string })[]>([])
  // Recommendations follow the last product this shopper opened here; a first-time visitor has
  // none, so they simply do not see the section.
  const viewedId = lastViewed(store.id)
  const sections = theme ? visibleSections(theme) : DEFAULT_SECTIONS
  const wantsReviews = sections.includes('reviews')

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

  useEffect(() => {
    if (!wantsReviews) return
    let cancelled = false
    storefrontApi
      .featuredReviews(store.id)
      .then((r) => !cancelled && setReviews(r.data))
      .catch(() => !cancelled && setReviews([]))
    return () => {
      cancelled = true
    }
  }, [store.id, wantsReviews])

  const hero = (
    <section key="hero" aria-labelledby="home-heading" className={`relative grid items-center gap-6 overflow-hidden rounded-3xl border border-border bg-surface px-6 py-12 sm:px-10 ${theme?.bannerUrl ? 'md:grid-cols-2' : ''}`}>
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand/15 blur-[90px]" />
      <div className="relative flex flex-col items-start gap-4">
        <h1 id="home-heading" className="font-serif text-h1 font-normal italic tracking-tight">
          {theme?.heroHeadline || store.name}
        </h1>
        <p className="max-w-xl text-sm text-text-secondary">
          {theme?.heroText || 'Browse the latest arrivals or jump straight to a category. Checkout is secure and you do not need an account to buy.'}
        </p>
        <Link to={`/store/${store.id}/products`} className={buttonStyles()}>
          Shop all products
        </Link>
      </div>
      {theme?.bannerUrl && <img src={theme.bannerUrl} alt="" className="relative aspect-[4/3] w-full rounded-2xl object-cover" />}
    </section>
  )

  const featured = (
    <section key="featured" aria-labelledby="new-heading" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 id="new-heading" className="font-display text-xl font-bold">
          New arrivals
        </h2>
        <Link to={`/store/${store.id}/products`} className="text-sm font-semibold text-brand-ink hover:text-brand-ink-hover">
          See all
        </Link>
      </div>
      {products === null && !loadError && <ProductGridSkeleton count={4} />}
      {products?.length === 0 && (
        <p className="rounded-2xl border border-border bg-surface px-6 py-12 text-center text-sm text-text-secondary">This store has no products yet. Please check back soon.</p>
      )}
      <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {products?.map((p) => (
          <ProductCard key={p.id} product={p} storeId={store.id} currency={store.currency} adding={addingId === p.id} onAdd={(x) => void addToCart(x)} />
        ))}
      </ul>
    </section>
  )

  const categoryList =
    categories.length > 0 ? (
      <section key="categories" aria-labelledby="cat-heading" className="flex flex-col gap-4">
        <h2 id="cat-heading" className="font-display text-xl font-bold">
          Shop by category
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {categories.map((c) => (
            <li key={c.name}>
              <Link
                to={`/store/${store.id}/products?category=${encodeURIComponent(c.name)}`}
                className="flex h-full flex-col gap-1 rounded-2xl border border-border bg-surface p-4 hover:border-brand-ink"
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
    ) : null

  const reviewList =
    reviews.length > 0 ? (
      <section key="reviews" aria-labelledby="reviews-heading" className="flex flex-col gap-4">
        <h2 id="reviews-heading" className="font-display text-xl font-bold">
          What customers say
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reviews.slice(0, 3).map((r) => (
            <li key={r.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
              <span className="flex items-center gap-0.5 text-star" aria-label={`${r.rating} out of 5 stars`}>
                {Array.from({ length: 5 }, (_, i) => (
                  <Star key={i} aria-hidden="true" className="h-4 w-4" fill={i < r.rating ? 'currentColor' : 'none'} strokeWidth={1.75} />
                ))}
              </span>
              <p className="text-sm text-text">{r.comment}</p>
              <p className="mt-auto text-xs text-text-secondary">
                {r.authorName}, on{' '}
                <Link to={`/store/${store.id}/products/${r.productId}`} className="font-semibold text-brand-ink hover:text-brand-ink-hover">
                  {r.productTitle}
                </Link>
              </p>
            </li>
          ))}
        </ul>
      </section>
    ) : null

  const aboutText = theme?.aboutText || store.description
  const about = aboutText ? (
    <section key="about" aria-labelledby="about-heading" className="flex flex-col gap-3 rounded-3xl border border-border bg-surface px-6 py-10 sm:px-10">
      <h2 id="about-heading" className="font-display text-xl font-bold">
        About {store.name}
      </h2>
      <p className="max-w-2xl whitespace-pre-line text-sm leading-relaxed text-text-secondary">{aboutText}</p>
    </section>
  ) : null

  const blocks: Record<SectionId, React.ReactNode> = { hero, featured, categories: categoryList, reviews: reviewList, about }

  return (
    <div className="flex flex-col gap-10">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {loadError && <Alert>{loadError}</Alert>}
      {sections.map((id) => (
        <div key={id} className="contents">
          {blocks[id]}
          {/* Recommendations stay right after the products, wherever the owner puts them. */}
          {id === 'featured' && viewedId && <RecommendationsSection productId={viewedId} heading="Recommended for you" headingId="reco-heading" />}
        </div>
      ))}
      {!sections.includes('featured') && viewedId && <RecommendationsSection productId={viewedId} heading="Recommended for you" headingId="reco-heading" />}
    </div>
  )
}
