import { Badge } from '../ui/Badge'
import { StarRating } from '../StarRating'
import { formatDate } from '../../lib/format'
import type { Review } from '../../types/shop'

/** One review. The text is shown as plain text (React escapes it), keeping the reviewer's line breaks. */
export function ReviewCard({ review, storeName }: { review: Review; storeName: string }) {
  return (
    <article className="flex flex-col gap-2 border-b border-border py-5 last:border-b-0">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StarRating value={review.rating} size="sm" />
        <span className="text-sm font-semibold">{review.authorName}</span>
        {review.verifiedPurchase && <Badge tone="success">Verified purchase</Badge>}
        <time dateTime={review.createdAt} className="text-xs text-text-secondary">
          {formatDate(review.createdAt)}
        </time>
      </header>
      {review.title && <h3 className="text-sm font-bold">{review.title}</h3>}
      {review.comment && <p className="whitespace-pre-line text-sm leading-relaxed text-text-secondary">{review.comment}</p>}
      {review.merchantReply && (
        <div className="mt-1 rounded-[10px] bg-bg px-4 py-3">
          <p className="text-xs font-bold">Reply from {storeName}</p>
          <p className="mt-1 whitespace-pre-line text-sm text-text-secondary">{review.merchantReply}</p>
        </div>
      )}
    </article>
  )
}
