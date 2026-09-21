import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useStore } from '../../context/StoreContext'
import { Alert } from '../ui/Alert'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Spinner } from '../ui/Spinner'
import { StarRating } from '../StarRating'
import { ReviewCard } from './ReviewCard'
import { ReviewForm } from './ReviewForm'
import { errorMessage } from '../../lib/ordersApi'
import { reviewsApi } from '../../lib/shopApi'
import type { OwnReview, Review, ReviewInput, ReviewPage, ReviewSort } from '../../types/shop'

const PAGE = 5
const SORTS: Record<ReviewSort, string> = { newest: 'Newest', oldest: 'Oldest', highest: 'Highest rated', lowest: 'Lowest rated' }

/** The average, the count and how many gave each star; each row filters the list to that rating. */
function Summary({ page, filter, onFilter }: { page: ReviewPage; filter: number | null; onFilter: (n: number | null) => void }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-10">
      <div className="flex flex-col items-start gap-1">
        <p className="font-display text-5xl font-bold">{page.averageRating === null ? '-' : page.averageRating.toFixed(1)}</p>
        <StarRating value={page.averageRating} size="lg" />
        <p className="text-sm text-text-secondary">
          {page.reviewCount} {page.reviewCount === 1 ? 'review' : 'reviews'}
        </p>
      </div>
      <ul className="flex flex-1 flex-col gap-1.5" aria-label="Reviews by rating">
        {([5, 4, 3, 2, 1] as const).map((n) => {
          const count = page.distribution[String(n) as '1']
          const pct = page.reviewCount ? (count / page.reviewCount) * 100 : 0
          return (
            <li key={n}>
              <button
                onClick={() => onFilter(filter === n ? null : n)}
                aria-pressed={filter === n}
                disabled={count === 0}
                className="grid w-full grid-cols-[52px_1fr_36px] items-center gap-3 rounded text-left text-sm disabled:opacity-60"
              >
                <span className={filter === n ? 'font-bold text-brand' : 'text-text-secondary'}>{n} stars</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-bg">
                  <span className="block h-full rounded-full bg-star" style={{ width: `${pct}%` }} />
                </span>
                <span className="text-right text-text-secondary">{count}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function ReviewsSection({ productId, onChanged }: { productId: string; onChanged: () => void }) {
  const store = useStore()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const location = useLocation()
  const [page, setPage] = useState<ReviewPage | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [sort, setSort] = useState<ReviewSort>('newest')
  const [filter, setFilter] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(
    async (offset: number, append: boolean) => {
      const r = await reviewsApi.list(store.id, productId, { sort, rating: filter ?? undefined, limit: PAGE, offset })
      setPage(r)
      setReviews((cur) => (append ? [...cur, ...r.data] : r.data))
    },
    [store.id, productId, sort, filter]
  )

  // Wait for the silent sign-in restore so a returning shopper's own review comes back with the first load.
  useEffect(() => {
    if (authLoading) return
    let cancelled = false
    setError(null)
    load(0, false).catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [load, authLoading, isAuthenticated])

  async function showMore() {
    setLoadingMore(true)
    try {
      await load(reviews.length, true)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoadingMore(false)
    }
  }

  async function refreshAll() {
    await load(0, false)
    onChanged()
  }

  async function save(input: ReviewInput, existing: OwnReview | null) {
    if (existing) await reviewsApi.update(store.id, productId, input)
    else await reviewsApi.create(store.id, productId, input)
    setEditing(false)
    setNotice(existing ? 'Your review was updated.' : 'Thank you. Your review is published.')
    await refreshAll()
  }

  async function remove() {
    try {
      await reviewsApi.remove(store.id, productId)
      setDeleting(false)
      setNotice('Your review was deleted.')
      await refreshAll()
    } catch (e) {
      setDeleting(false)
      setError(errorMessage(e))
    }
  }

  const mine = page?.myReview ?? null
  const next = `${location.pathname}#reviews`

  return (
    <section id="reviews" aria-labelledby="reviews-heading" className="flex flex-col gap-6 scroll-mt-6">
      <h2 id="reviews-heading" className="font-display text-xl font-bold">
        Customer reviews
      </h2>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {!page && !error && <Spinner label="Loading reviews" />}

      {page && (
        <>
          {page.reviewCount > 0 || filter ? <Summary page={page} filter={filter} onFilter={setFilter} /> : <p className="text-sm text-text-secondary">No reviews yet. Be the first to review this product.</p>}

          <div className="rounded-2xl border border-border bg-white p-5">
            {!isAuthenticated ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm">Bought this? Share what you think.</p>
                <Link to={`/store/${store.id}/account/login?next=${encodeURIComponent(next)}`} className="inline-flex h-10 items-center rounded-[10px] bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-hover">
                  Sign in to write a review
                </Link>
              </div>
            ) : mine && !editing ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold">Your review</h3>
                  {mine.status === 'hidden' && <Badge tone="warning">Hidden by the store</Badge>}
                </div>
                {mine.status === 'hidden' && <p className="text-xs text-text-secondary">Only you can see this review right now.</p>}
                <ReviewCard review={mine} storeName={store.name} />
                <div className="flex gap-3">
                  <Button variant="secondary" className="h-10" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                  <Button variant="danger" className="h-10" onClick={() => setDeleting(true)}>
                    Delete
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-bold">{mine ? 'Edit your review' : 'Write a review'}</h3>
                <ReviewForm
                  initial={mine ?? undefined}
                  submitLabel={mine ? 'Save changes' : 'Post review'}
                  onSubmit={(input) => save(input, mine)}
                  onCancel={mine ? () => setEditing(false) : undefined}
                />
              </div>
            )}
          </div>

          {(page.reviewCount > 0 || filter) && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-text-secondary" role="status" aria-live="polite">
                  {filter ? `Showing ${page.pagination.total} ${filter}-star ${page.pagination.total === 1 ? 'review' : 'reviews'}` : `${page.pagination.total} ${page.pagination.total === 1 ? 'review' : 'reviews'}`}
                  {filter && (
                    <button onClick={() => setFilter(null)} className="ml-2 font-semibold text-brand">
                      Show all
                    </button>
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <label htmlFor="review-sort" className="text-xs font-semibold text-text-secondary">
                    Sort by
                  </label>
                  <select id="review-sort" value={sort} onChange={(e) => setSort(e.target.value as ReviewSort)} className="h-10 rounded-[10px] border border-border bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30">
                    {Object.entries(SORTS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                {reviews.map((r) => (
                  <ReviewCard key={r.id} review={r} storeName={store.name} />
                ))}
              </div>
              {reviews.length < page.pagination.total && (
                <Button variant="secondary" onClick={() => void showMore()} disabled={loadingMore} className="self-center">
                  {loadingMore ? 'Loading...' : `Show more reviews (${page.pagination.total - reviews.length} left)`}
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {deleting && (
        <Dialog open title="Delete your review?" onClose={() => setDeleting(false)}>
          <p className="text-sm text-text-secondary">It will be removed from this page and from the average rating. You can write a new one afterwards.</p>
          <div className="mt-5 flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setDeleting(false)}>
              Keep it
            </Button>
            <Button variant="danger" className="flex-1" onClick={() => void remove()}>
              Delete
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  )
}
