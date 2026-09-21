import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../../context/AuthContext'
import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Spinner } from '../../components/ui/Spinner'
import { StarRating } from '../../components/StarRating'
import { formatDate } from '../../lib/format'
import { errorMessage } from '../../lib/ordersApi'
import { reviewsAdminApi } from '../../lib/shopApi'
import type { ModerationReview } from '../../types/shop'

const PAGE = 20

function ReplyDialog({ review, onClose, onSave }: { review: ModerationReview; onClose: () => void; onSave: (reply: string | null) => Promise<void> }) {
  const [text, setText] = useState(review.merchantReply ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSave(text.trim() || null)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open title={`Reply to ${review.authorName}`} onClose={onClose} size="lg">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="rounded-[10px] bg-bg px-4 py-3 text-sm text-text-secondary">{review.comment ?? review.title ?? `${review.rating} stars, no comment`}</p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reply" className="text-xs font-semibold text-text-secondary">Your public reply (leave empty to remove it)</label>
          <textarea id="reply" rows={4} maxLength={1000} autoFocus value={text} onChange={(e) => setText(e.target.value)} className="rounded-[10px] border border-border px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30" />
        </div>
        {error && <Alert>{error}</Alert>}
        <div className="flex gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" className="flex-1" disabled={busy}>{busy ? 'Saving...' : 'Post reply'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Every review in the store, for hiding the ones that should not be shown and replying to the rest. */
export function ReviewsAdminPage() {
  const { activeStore } = useAuth()
  const storeId = activeStore?.id
  const [status, setStatus] = useState<'' | 'published' | 'hidden'>('')
  const [rating, setRating] = useState('')
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<{ reviews: ModerationReview[]; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [replying, setReplying] = useState<ModerationReview | null>(null)

  const load = useCallback(async () => {
    if (!storeId) return
    const r = await reviewsAdminApi.list(storeId, { status: status || undefined, rating: rating ? Number(rating) : undefined, limit: PAGE, offset })
    setData({ reviews: r.data, total: r.pagination.total })
  }, [storeId, status, rating, offset])

  useEffect(() => {
    setError(null)
    load().catch((e) => setError(errorMessage(e)))
  }, [load])

  async function moderate(review: ModerationReview, body: { status?: 'published' | 'hidden'; reply?: string | null }) {
    const updated = await reviewsAdminApi.moderate(storeId!, review.id, body)
    setData((cur) => (cur ? { ...cur, reviews: cur.reviews.map((r) => (r.id === updated.id ? updated : r)) } : cur))
  }

  if (!activeStore) return <p className="text-sm text-text-secondary">Create a store first.</p>
  const select = 'h-10 rounded-[10px] border border-border bg-white px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30'

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Reviews</h1>
        <p className="mt-1 text-sm text-text-secondary">A hidden review is kept but not shown or counted, and its author cannot post another. You cannot edit what a customer wrote.</p>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="f-status" className="text-xs font-semibold text-text-secondary">Show</label>
          <select id="f-status" className={select} value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setOffset(0) }}>
            <option value="">All reviews</option>
            <option value="published">Published</option>
            <option value="hidden">Hidden</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-rating" className="text-xs font-semibold text-text-secondary">Stars</label>
          <select id="f-rating" className={select} value={rating} onChange={(e) => { setRating(e.target.value); setOffset(0) }}>
            <option value="">Any</option>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} stars</option>)}
          </select>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {!data && !error && <Spinner label="Loading reviews" />}
      {data?.reviews.length === 0 && (
        <p className="rounded-2xl border border-border bg-white px-6 py-12 text-center text-sm text-text-secondary">No reviews match. Reviews appear here as soon as customers post them.</p>
      )}

      <ul className="flex flex-col gap-3">
        {data?.reviews.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-white p-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <StarRating value={r.rating} size="sm" />
              <span className="text-sm font-semibold">{r.authorName}</span>
              {r.verifiedPurchase && <Badge tone="success">Verified purchase</Badge>}
              {r.status === 'hidden' && <Badge tone="warning">Hidden</Badge>}
              <span className="text-xs text-text-secondary">{formatDate(r.createdAt)} on {r.productTitle}</span>
            </div>
            {r.title && <p className="text-sm font-bold">{r.title}</p>}
            {r.comment && <p className="whitespace-pre-line text-sm text-text-secondary">{r.comment}</p>}
            {r.merchantReply && (
              <p className="rounded-[10px] bg-bg px-4 py-2.5 text-sm text-text-secondary">
                <span className="font-semibold text-text">Your reply: </span>{r.merchantReply}
              </p>
            )}
            <div className="flex gap-4 pt-1 text-sm">
              <button
                onClick={() => void moderate(r, { status: r.status === 'hidden' ? 'published' : 'hidden' }).catch((e) => setError(errorMessage(e)))}
                className="font-semibold text-brand hover:text-brand-hover"
                aria-label={`${r.status === 'hidden' ? 'Show' : 'Hide'} the review by ${r.authorName}`}
              >
                {r.status === 'hidden' ? 'Show' : 'Hide'}
              </button>
              <button onClick={() => setReplying(r)} className="font-semibold text-brand hover:text-brand-hover" aria-label={`${r.merchantReply ? 'Edit reply to' : 'Reply to'} ${r.authorName}`}>
                {r.merchantReply ? 'Edit reply' : 'Reply'}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {data && data.total > PAGE && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-secondary">{offset + 1}-{Math.min(offset + PAGE, data.total)} of {data.total}</span>
          <div className="flex gap-2">
            <Button variant="secondary" className="h-10" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
            <Button variant="secondary" className="h-10" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
          </div>
        </div>
      )}

      {replying && (
        <ReplyDialog
          review={replying}
          onClose={() => setReplying(null)}
          onSave={async (reply) => {
            await moderate(replying, { reply })
            setReplying(null)
          }}
        />
      )}
    </div>
  )
}
