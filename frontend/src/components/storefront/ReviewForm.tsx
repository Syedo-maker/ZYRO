import { useState, type FormEvent } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { errorMessage } from '../../lib/ordersApi'
import type { ReviewInput } from '../../types/shop'

const LABELS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent']

/** A star picker that behaves as a radio group: arrow keys move, and the choice is announced in words. */
function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Your rating" className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} ${n === 1 ? 'star' : 'stars'}, ${LABELS[n - 1]}`}
          tabIndex={value === n || (value === 0 && n === 1) ? 0 : -1}
          onClick={() => onChange(n)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
              e.preventDefault()
              onChange(Math.min(5, (value || 0) + 1))
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
              e.preventDefault()
              onChange(Math.max(1, (value || 2) - 1))
            }
          }}
          className={`rounded p-0.5 ${n <= value ? 'text-star' : 'text-border'} hover:text-star focus-visible:outline-2 focus-visible:outline-brand`}
        >
          <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden="true">
            <path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.5l-5.9 3.2 1.2-6.6L2.5 9.5l6.6-.9L12 2.5z" fill="currentColor" />
          </svg>
        </button>
      ))}
      <span className="ml-2 text-sm text-text-secondary" aria-live="polite">
        {value ? LABELS[value - 1] : 'Choose a rating'}
      </span>
    </div>
  )
}

export function ReviewForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: { rating: number; title: string | null; comment: string | null }
  submitLabel: string
  onSubmit: (input: ReviewInput) => Promise<void>
  onCancel?: () => void
}) {
  const [rating, setRating] = useState(initial?.rating ?? 0)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [comment, setComment] = useState(initial?.comment ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (rating < 1) return setError('Choose a star rating first.')
    setError(null)
    setBusy(true)
    try {
      await onSubmit({ rating, title: title.trim() || undefined, comment: comment.trim() || undefined })
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-2xl border border-border bg-white p-5" aria-label="Write a review">
      <StarPicker value={rating} onChange={setRating} />
      <Input id="review-title" label="Headline (optional)" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="review-comment" className="text-xs font-semibold text-text-secondary">
          Your review (optional)
        </label>
        <textarea
          id="review-comment"
          rows={4}
          maxLength={2000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="rounded-[10px] border border-border px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        <span className="self-end text-xs text-text-muted">{comment.length} / 2000</span>
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving...' : submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
