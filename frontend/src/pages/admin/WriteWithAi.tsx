import { useEffect, useState } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { upgradeHintOf } from '../../lib/billingApi'
import { UpgradeNotice } from '../../components/billing/UpgradeNotice'
import { errorMessage } from '../../lib/ordersApi'
import { productIdeasApi } from '../../lib/productIdeasApi'
import { SOURCE_LABELS, type ProductIdea, type ProductIdeaRequest, type ProductIdeas, type TrendingKeywords } from '../../types/ideas'

interface WriteWithAiProps {
  storeId: string
  /** Whatever the merchant has typed so far; the suggestions are built around it. */
  draft: ProductIdeaRequest
  /** Puts a chosen suggestion into the title and description fields. Nothing is saved until they save the form. */
  onUse: (idea: ProductIdea) => void
}

/**
 * "Write it myself" or "Write with AI" on the add-product form (Issue 1).
 *
 * Writing a listing is the part of adding a product that small shop owners get stuck on, so this
 * offers help without taking over. Four suggestions at a time, each one showing which popular
 * search words it actually uses, so the merchant can see where the wording came from instead of
 * trusting it. They can use one, edit it afterwards like any other text, or ignore the whole thing.
 *
 * Nothing here saves anything. One "Suggest" press is one AI generation, whether the merchant takes
 * a suggestion or not; pressing it again costs another, which is why the button says so.
 */
export function WriteWithAi({ storeId, draft, onUse }: WriteWithAiProps) {
  const [mode, setMode] = useState<'manual' | 'ai'>('manual')
  const [ideas, setIdeas] = useState<ProductIdeas | null>(null)
  const [keywords, setKeywords] = useState<TrendingKeywords | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quotaError, setQuotaError] = useState<unknown>(null)

  // The keyword list is free to read, so the merchant can see what shoppers are searching for
  // before deciding whether to spend a generation on it.
  useEffect(() => {
    if (mode !== 'ai' || keywords) return
    productIdeasApi
      .keywords(storeId, draft.category)
      .then(setKeywords)
      .catch(() => setKeywords(null))
  }, [mode, keywords, storeId, draft.category])

  async function suggest() {
    setLoading(true)
    setError(null)
    setQuotaError(null)
    try {
      setIdeas(await productIdeasApi.suggest(storeId, draft))
    } catch (err) {
      // A used-up allowance is not a failure, it is a fact: the merchant is told, and the form
      // keeps working by hand.
      if (upgradeHintOf(err)) setQuotaError(err)
      else setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section aria-labelledby="write-with-ai-heading" className="flex flex-col gap-3 rounded-[10px] border border-border bg-bg p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="write-with-ai-heading" className="text-sm font-semibold">
          Name and describe this product
        </h3>
        <div role="group" aria-label="How to write this listing" className="flex gap-1 rounded-[10px] border border-border bg-white p-1">
          <button
            type="button"
            aria-pressed={mode === 'manual'}
            onClick={() => setMode('manual')}
            className={`rounded-[8px] px-3 py-1.5 text-xs font-semibold ${mode === 'manual' ? 'bg-brand text-white' : 'text-text-secondary hover:text-text'}`}
          >
            Write it myself
          </button>
          <button
            type="button"
            aria-pressed={mode === 'ai'}
            onClick={() => setMode('ai')}
            className={`rounded-[8px] px-3 py-1.5 text-xs font-semibold ${mode === 'ai' ? 'bg-brand text-white' : 'text-text-secondary hover:text-text'}`}
          >
            Write with AI
          </button>
        </div>
      </div>

      {mode === 'manual' && (
        <p className="text-xs text-text-secondary">Fill in the title and description below yourself, or switch to AI for a few suggestions to start from.</p>
      )}

      {mode === 'ai' && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-text-secondary">
            Fill in anything you know first (a rough title, the category, a few notes) and the suggestions will use it. Each set of suggestions uses one AI generation
            from this month&apos;s allowance.
          </p>

          {keywords && keywords.trendDataAvailable && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-text-secondary">Popular searches for this category right now</p>
              <ul className="flex flex-wrap gap-1.5">
                {keywords.keywords.slice(0, 8).map((k) => (
                  <li key={k.word}>
                    <Badge tone="neutral">{k.word}</Badge>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-text-muted">From {keywords.sources.map((s) => SOURCE_LABELS[s]).join(', ')}.</p>
            </div>
          )}

          {keywords && !keywords.trendDataAvailable && (
            <p className="text-xs text-text-muted">
              We do not have trend data for this category yet, so the suggestions will be based only on the details you enter.
            </p>
          )}

          {quotaError ? <UpgradeNotice error={quotaError} /> : null}
          {quotaError ? (
            <p className="text-xs text-text-secondary">You can still write the title and description yourself below.</p>
          ) : null}
          {error && <Alert>{error}</Alert>}

          <div>
            <Button type="button" onClick={() => void suggest()} disabled={loading}>
              {loading ? 'Thinking…' : ideas ? 'Suggest again (uses 1 generation)' : 'Suggest 4 options (uses 1 generation)'}
            </Button>
          </div>

          {loading && (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          )}

          {ideas && !loading && ideas.suggestions.length === 0 && (
            <Alert>The AI did not return anything usable this time. Try again, or write the listing yourself below.</Alert>
          )}

          {ideas && !loading && ideas.suggestions.length > 0 && (
            <>
              {ideas.notice && <p className="text-xs text-text-muted">{ideas.notice}</p>}
              <ul role="list" className="flex flex-col gap-3">
                {ideas.suggestions.map((idea, i) => (
                  <li key={`${idea.title}-${i}`} className="flex flex-col gap-2 rounded-[10px] border border-border bg-white p-3">
                    <p className="text-sm font-semibold">{idea.title}</p>
                    <p className="text-sm text-text-secondary">{idea.description}</p>
                    {idea.keywordsUsed.length > 0 && (
                      <p className="text-xs text-text-muted">Uses popular searches: {idea.keywordsUsed.join(', ')}</p>
                    )}
                    <div>
                      <button
                        type="button"
                        onClick={() => onUse(idea)}
                        className="text-xs font-semibold text-brand hover:text-brand-hover"
                      >
                        Use this
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-text-muted">
                Nothing is saved until you save the product, and you can edit any of this afterwards.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  )
}
