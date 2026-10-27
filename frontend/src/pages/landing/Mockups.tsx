/**
 * Small, original mock-ups of our own screens, drawn in markup rather than photographed.
 *
 * Deliberately not screenshots: a screenshot of a dashboard shrunk into a card is unreadable, goes
 * stale the moment the UI changes, and costs a few hundred kilobytes each. These reproduce the
 * shapes and the real wording of the features they illustrate, weigh nothing, stay sharp at any
 * size, and are marked `aria-hidden` because the text beside them already says what they show.
 *
 * Every string here is wording the product genuinely uses. Nothing invents a number.
 */

const frame = 'rounded-xl border border-border bg-surface p-4 shadow-lg shadow-black/5'

/** The feature itself: suggestions with their keyword attribution, as the Add product form shows it. */
export function TrendingMockup() {
  return (
    <div aria-hidden="true" className={frame}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-text-muted">Add product</span>
        <span className="rounded-full bg-inverse px-2 py-0.5 text-[10px] font-semibold text-on-inverse">Write with AI</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {['lawn suit', '3 piece', 'summer'].map((w) => (
          <span key={w} className="rounded-full bg-subtle px-2 py-0.5 text-[10px] font-medium text-text">
            {w}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {[
          { t: 'Summer Lawn Suit, 3 Piece', k: 'lawn suit, 3 piece, summer' },
          { t: 'Stitched Lawn Suit in Soft Cotton', k: 'lawn suit' },
        ].map((s) => (
          <div key={s.t} className="rounded-lg bg-bg p-2.5">
            <p className="text-[11px] font-bold text-text">{s.t}</p>
            <p className="mt-1 text-[10px] text-accent">Uses popular searches: {s.k}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The shopping assistant, which answers from the shop's own catalogue. */
export function AssistantMockup() {
  return (
    <div aria-hidden="true" className={frame}>
      <span className="text-[11px] font-semibold text-text-muted">Shop assistant</span>
      <div className="mt-3 flex flex-col gap-2">
        <p className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-inverse px-3 py-2 text-[11px] text-on-inverse">
          Something under 2000 for my sister?
        </p>
        <p className="max-w-[85%] rounded-2xl rounded-bl-sm bg-bg px-3 py-2 text-[11px] text-text">
          These three are in stock under Rs 2,000. Want me to show the jhumkas?
        </p>
      </div>
      <div className="mt-2.5 flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-10 flex-1 rounded-md bg-subtle" />
        ))}
      </div>
    </div>
  )
}

/** "Products like this one", from the recommendation service. */
export function RecommendationsMockup() {
  return (
    <div aria-hidden="true" className={frame}>
      <span className="text-[11px] font-semibold text-text-muted">Products like this one</span>
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className={`h-12 rounded-md ${i === 0 ? 'bg-inverse' : 'bg-subtle'}`} />
            <div className="h-1.5 w-full rounded bg-inverse/15" />
            <div className="h-1.5 w-2/3 rounded bg-inverse/10" />
          </div>
        ))}
      </div>
      <p className="mt-2.5 text-[10px] text-text-muted">Matched on what the product is, not on what it is called.</p>
    </div>
  )
}

/** The abandoned-cart reminder, which the merchant approves. */
export function CartRecoveryMockup() {
  return (
    <div aria-hidden="true" className={frame}>
      <span className="text-[11px] font-semibold text-text-muted">Cart reminder</span>
      <div className="mt-3 rounded-lg bg-bg p-3">
        <p className="text-[11px] font-bold text-text">Still thinking about the clay cups?</p>
        <p className="mt-1 text-[10px] text-text-secondary">They are still in your basket, and still in stock.</p>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span className="rounded-md bg-inverse px-2 py-1 text-[10px] font-semibold text-on-inverse">Send</span>
        <span className="text-[10px] text-text-muted">You approve every message before it goes.</span>
      </div>
    </div>
  )
}

/** A weekly insight, written from the shop's own figures. */
export function InsightsMockup() {
  return (
    <div aria-hidden="true" className={frame}>
      <span className="text-[11px] font-semibold text-text-muted">This week</span>
      <div className="mt-3 flex items-end gap-1.5">
        {[38, 52, 44, 61, 70, 58, 76].map((h, i) => (
          <div key={i} className="flex-1 rounded-t bg-subtle" style={{ height: `${h * 0.6}px` }}>
            <div className="h-1 w-full rounded-t bg-accent-display" />
          </div>
        ))}
      </div>
      <p className="mt-3 rounded-lg bg-bg p-2.5 text-[10px] leading-relaxed text-text">
        Weekend sales are climbing while Tuesdays stay quiet. Worth putting your next discount code on a Tuesday.
      </p>
    </div>
  )
}
