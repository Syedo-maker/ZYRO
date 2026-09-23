import { useEffect, useState } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { ApiError } from '../../lib/apiClient'
import { errorMessage } from '../../lib/ordersApi'
import { aiUsageApi, aiDescriptionApi, aiSuggestionsApi, aiReviewSummaryApi } from '../../lib/aiContentApi'
import type { AiDescriptionDraft, AiUsageQuota, AutoTagSuggestion, ReviewSummaryStatus, SeoMetadataSuggestion } from '../../types/shop'

interface AiToolsPanelProps {
  storeId: string
  productId: string
  /** Copies the published/drafted text straight into the description field, for the merchant to review before saving the form. */
  onApplyDescription: (text: string) => void
  onApplyCategoryAndTags: (category: string, tags: string[]) => void
  onApplySeo: (seoTitle: string, seoDescription: string) => void
}

/** One line: "12 of 50 AI generations used this month", or a plain refused message once exhausted. */
function QuotaLine({ usage }: { usage: AiUsageQuota | null }) {
  if (!usage) return null
  const remaining = usage.generationsLimit - usage.generationsUsed
  return (
    <p className="text-xs text-text-muted">
      {remaining > 0
        ? `${usage.generationsUsed} of ${usage.generationsLimit} AI generations used this month`
        : `All ${usage.generationsLimit} AI generations for this month are used; more become available next month.`}
    </p>
  )
}

function quotaExhausted(err: unknown): boolean {
  return err instanceof ApiError && err.status === 402
}

/**
 * AI Content Tools (Implementation_Plan.md Phase 4, Module 6), wired into the Admin Catalog
 * product form. Auto-tag and SEO metadata are pure suggestions: nothing here saves them to the
 * product directly, matching the plan's "never silently overwrite merchant data" - applying a
 * suggestion only fills the form fields above, and the merchant still has to press Save.
 */
export function AiToolsPanel({ storeId, productId, onApplyDescription, onApplyCategoryAndTags, onApplySeo }: AiToolsPanelProps) {
  const [usage, setUsage] = useState<AiUsageQuota | null>(null)
  const [draft, setDraft] = useState<AiDescriptionDraft | null>(null)
  const [draftText, setDraftText] = useState('')
  const [reviewSummary, setReviewSummary] = useState<ReviewSummaryStatus | null>(null)
  const [tagSuggestion, setTagSuggestion] = useState<AutoTagSuggestion | null>(null)
  const [seoSuggestion, setSeoSuggestion] = useState<SeoMetadataSuggestion | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([aiUsageApi.get(storeId), aiDescriptionApi.get(storeId, productId), aiReviewSummaryApi.get(storeId, productId)])
      .then(([u, d, s]) => {
        if (cancelled) return
        setUsage(u)
        setDraft(d)
        setDraftText(d?.content ?? '')
        setReviewSummary(s)
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoaded(true))
    return () => {
      cancelled = true
    }
  }, [storeId, productId])

  async function run<T>(name: string, action: () => Promise<T>): Promise<T | undefined> {
    setBusy(name)
    setError(null)
    try {
      const result = await action()
      const fresh = await aiUsageApi.get(storeId)
      setUsage(fresh)
      return result
    } catch (e) {
      setError(quotaExhausted(e) ? `This store has used all ${usage?.generationsLimit ?? ''} AI generations included this month.` : errorMessage(e))
      return undefined
    } finally {
      setBusy(null)
    }
  }

  async function handleGenerate() {
    const result = await run('generate', () => aiDescriptionApi.generate(storeId, productId))
    if (result) {
      setDraft(result)
      setDraftText(result.content)
    }
  }
  async function handleRegenerate() {
    const result = await run('regenerate', () => aiDescriptionApi.regenerate(storeId, productId))
    if (result) {
      setDraft(result)
      setDraftText(result.content)
    }
  }
  async function handleSaveEdit() {
    const result = await run('save-edit', () => aiDescriptionApi.update(storeId, productId, draftText))
    if (result) setDraft(result)
  }
  async function handlePublish() {
    const result = await run('publish', () => aiDescriptionApi.publish(storeId, productId))
    if (result) {
      onApplyDescription(result.description)
      setDraft((d) => (d ? { ...d, status: 'published' } : d))
    }
  }
  async function handleAutoTag() {
    const result = await run('auto-tag', () => aiSuggestionsApi.autoTag(storeId, productId))
    if (result) setTagSuggestion(result)
  }
  async function handleSeoMetadata() {
    const result = await run('seo', () => aiSuggestionsApi.seoMetadata(storeId, productId))
    if (result) setSeoSuggestion(result)
  }
  async function handleSummarizeReviews() {
    const result = await run('summarize', () => aiReviewSummaryApi.generate(storeId, productId))
    if (result) setReviewSummary(result)
  }

  if (!loaded) return <p className="text-xs text-text-muted">Loading AI tools…</p>

  return (
    <div className="flex flex-col gap-5 rounded-[10px] border border-border bg-bg p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold">AI tools</h3>
        <QuotaLine usage={usage} />
      </div>
      {error && <Alert>{error}</Alert>}

      {/* ---- Description ---- */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-secondary">Description</span>
          {draft && <Badge tone={draft.status === 'published' ? 'success' : 'ai'}>{draft.status}</Badge>}
        </div>
        {!draft ? (
          <Button type="button" variant="secondary" className="h-9 self-start px-4 text-xs" disabled={busy !== null} onClick={() => void handleGenerate()}>
            {busy === 'generate' ? 'Generating…' : 'Generate description with AI'}
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <textarea
              aria-label="AI description draft"
              rows={3}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              className="rounded-[10px] border border-border bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" className="h-9 px-3 text-xs" disabled={busy !== null || draftText === draft.content} onClick={() => void handleSaveEdit()}>
                {busy === 'save-edit' ? 'Saving…' : 'Save edit'}
              </Button>
              <Button type="button" variant="secondary" className="h-9 px-3 text-xs" disabled={busy !== null} onClick={() => void handleRegenerate()}>
                {busy === 'regenerate' ? 'Regenerating…' : 'Regenerate'}
              </Button>
              <Button type="button" className="h-9 px-3 text-xs" disabled={busy !== null} onClick={() => void handlePublish()}>
                {busy === 'publish' ? 'Publishing…' : 'Publish to product'}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* ---- Review summary ---- */}
      <section className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-text-secondary">Review summary</span>
        {reviewSummary?.summary && <p className="text-sm text-text-secondary">{reviewSummary.summary.text}</p>}
        {reviewSummary?.stale && <p className="text-xs text-warning">New reviews have come in since this summary; regenerating will bring it up to date.</p>}
        {reviewSummary?.currentReviewCount === 0 ? (
          <p className="text-xs text-text-muted">This product has no published reviews yet.</p>
        ) : (
          <Button type="button" variant="secondary" className="h-9 self-start px-4 text-xs" disabled={busy !== null} onClick={() => void handleSummarizeReviews()}>
            {busy === 'summarize' ? 'Summarizing…' : reviewSummary?.summary ? 'Regenerate summary' : 'Summarize reviews'}
          </Button>
        )}
      </section>

      {/* ---- Auto-tag ---- */}
      <section className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-text-secondary">Category &amp; tags</span>
        <Button type="button" variant="secondary" className="h-9 self-start px-4 text-xs" disabled={busy !== null} onClick={() => void handleAutoTag()}>
          {busy === 'auto-tag' ? 'Thinking…' : 'Suggest category & tags'}
        </Button>
        {tagSuggestion && (
          <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-border bg-white p-2.5 text-sm">
            <span>
              <strong>{tagSuggestion.category}</strong> · {tagSuggestion.tags.join(', ')}
            </span>
            <Button type="button" className="h-8 px-3 text-xs" onClick={() => onApplyCategoryAndTags(tagSuggestion.category, tagSuggestion.tags)}>
              Apply
            </Button>
          </div>
        )}
      </section>

      {/* ---- SEO metadata ---- */}
      <section className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-text-secondary">SEO metadata</span>
        <Button type="button" variant="secondary" className="h-9 self-start px-4 text-xs" disabled={busy !== null} onClick={() => void handleSeoMetadata()}>
          {busy === 'seo' ? 'Thinking…' : 'Generate SEO title & description'}
        </Button>
        {seoSuggestion && (
          <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-white p-2.5 text-sm">
            <p>
              <strong>{seoSuggestion.seoTitle}</strong>
            </p>
            <p className="text-text-secondary">{seoSuggestion.seoDescription}</p>
            <Button type="button" className="h-8 self-start px-3 text-xs" onClick={() => onApplySeo(seoSuggestion.seoTitle, seoSuggestion.seoDescription)}>
              Apply
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
