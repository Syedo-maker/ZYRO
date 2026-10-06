import { useEffect, useRef, useState, type FormEvent } from 'react'
import { demoApi, type DemoExample, type DemoResult } from '../../lib/demoApi'

/**
 * The hero's live demo: a visitor types a product, and sees the same suggestions a merchant gets
 * on the Add product form, built from the same keyword sources.
 *
 * Two things it is careful about.
 *
 * **It tells the truth about what it is showing.** The server says whether an answer was generated
 * just now, served from a previous identical question, or is one of the prepared examples because
 * the demo's daily budget is spent. That is shown, not hidden, because a visitor being quietly
 * handed a canned answer labelled "live" is the sort of thing this project does not do.
 *
 * **It shows keywords, never numbers.** The keyword ordering is driven by weights on the server
 * which are not search volumes; they are never sent here, so there is nothing to misread.
 */

const CARD_STAGGER_MS = 140

export function TrendingDemo() {
  const [examples, setExamples] = useState<DemoExample[]>([])
  const [phrase, setPhrase] = useState('')
  const [result, setResult] = useState<DemoResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Drives the one-by-one card entrance; bumped on every new answer so the stagger replays. */
  const [run, setRun] = useState(0)
  const liveRegion = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    demoApi
      .examples()
      .then((r) => setExamples(r.examples))
      .catch(() => setExamples([]))
  }, [])

  // The first example is loaded automatically, so a visitor sees the feature working before they
  // type anything. It is cached on the server, so it costs nothing.
  useEffect(() => {
    if (examples.length === 0 || result) return
    void ask(examples[0].phrase, examples[0].category)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examples])

  async function ask(nextPhrase: string, category?: string) {
    setPhrase(nextPhrase)
    setLoading(true)
    setError(null)
    try {
      const answer = await demoApi.suggest(nextPhrase, category)
      setResult(answer)
      setRun((n) => n + 1)
    } catch {
      setError('The demo could not be reached just now. Everything else on this page still works.')
    } finally {
      setLoading(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const typed = phrase.trim()
    if (typed.length < 2) return
    void ask(typed)
  }

  return (
    <section aria-labelledby="demo-heading" className="w-full rounded-2xl bg-lp-cream p-5 text-lp-green shadow-2xl shadow-black/20 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="demo-heading" className="font-landing text-lg font-bold">
          Try it now
        </h2>
        <span className="rounded-full bg-lp-green px-3 py-1 text-xs font-semibold text-lp-cream">Trending in Pakistan</span>
      </div>
      <p className="mt-2 text-sm text-lp-green/80">Type something you sell. This is the same AI that helps you write a listing.</p>

      <form onSubmit={submit} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="demo-phrase" className="sr-only">
          A product you sell
        </label>
        <input
          id="demo-phrase"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          maxLength={60}
          placeholder="lawn suit"
          className="h-11 flex-1 rounded-[10px] border border-lp-green/25 bg-white px-3.5 text-sm text-lp-green outline-none placeholder:text-lp-green/40 focus-visible:border-lp-green focus-visible:ring-2 focus-visible:ring-lp-accent-strong"
        />
        <button
          type="submit"
          disabled={loading || phrase.trim().length < 2}
          className="h-11 rounded-[10px] bg-lp-accent-strong px-5 text-sm font-semibold text-white transition-colors hover:bg-lp-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lp-green disabled:opacity-60"
        >
          {loading ? 'Thinking…' : 'Suggest'}
        </button>
      </form>

      {examples.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-lp-green/70">Or try:</span>
          {examples.slice(0, 4).map((ex) => (
            <button
              key={ex.phrase}
              type="button"
              onClick={() => void ask(ex.phrase, ex.category)}
              className="rounded-full border border-lp-green/25 px-2.5 py-1 text-xs font-medium text-lp-green transition-colors hover:border-lp-green hover:bg-lp-sage focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lp-green"
            >
              {ex.phrase}
            </button>
          ))}
        </div>
      )}

      {/* Announced to a screen reader when an answer arrives, since the cards appear silently. */}
      <p ref={liveRegion} aria-live="polite" className="sr-only">
        {loading ? 'Generating suggestions' : result ? `${result.suggestions.length} suggestions ready for ${result.phrase}` : ''}
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-[10px] bg-white px-3.5 py-2.5 text-sm text-lp-accent-strong">
          {error}
        </p>
      )}

      {result && !error && (
        <div className="mt-4 flex flex-col gap-3">
          {result.keywords.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-lp-green/70">Popular searches:</span>
              {result.keywords.slice(0, 6).map((word) => (
                <span key={word} className="rounded-full bg-lp-sage px-2.5 py-0.5 text-xs font-medium text-lp-green">
                  {word}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-lp-green/70">
              We do not have trend data for this category yet, so these are written from the product name alone.
            </p>
          )}

          <ul role="list" className="flex flex-col gap-2.5">
            {result.suggestions.map((s, i) => (
              <li
                key={`${run}-${i}`}
                className="rounded-[10px] bg-white p-3.5 motion-safe:animate-[demoCardIn_480ms_ease-out_both]"
                style={{ animationDelay: `${i * CARD_STAGGER_MS}ms` }}
              >
                <p className="font-landing text-sm font-bold">{s.title}</p>
                <p className="mt-1 text-sm text-lp-green/80">{s.description}</p>
                {s.keywordsUsed.length > 0 && (
                  <p className="mt-2 text-xs font-medium text-lp-accent-strong">Uses popular searches: {s.keywordsUsed.join(', ')}</p>
                )}
              </li>
            ))}
          </ul>

          {/* Honest about the source. A saved example is never dressed up as a fresh one, which is
              why `example` has its own line rather than falling through to "written just now". */}
          <p className="text-xs text-lp-green/60">
            {result.note
              ? result.note
              : result.origin === 'live'
                ? 'Written just now, from what people are really searching for.'
                : result.origin === 'cached'
                  ? 'Someone asked for this one already, so it came from the cache.'
                  : 'A prepared example, written by the same AI. Type your own product above to see it work live.'}
          </p>
        </div>
      )}
    </section>
  )
}
