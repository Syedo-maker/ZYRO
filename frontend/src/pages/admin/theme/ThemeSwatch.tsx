import { safeTokens, type ThemeTokens } from '../../../lib/storeTheme'

/**
 * A small picture of a look, drawn from its own tokens (Store Themes): the page, a card with text,
 * a link and a button, in the look's colours and shapes. Used on the recommendation cards and the
 * preset picker. Purely decorative; the card's name and reason are the text alternative.
 */
export function ThemeSwatch({ tokens, className = '' }: { tokens: ThemeTokens; className?: string }) {
  const t = safeTokens(tokens)
  return (
    <div aria-hidden="true" className={`flex h-16 items-center gap-2 overflow-hidden rounded-lg border border-border p-2 ${className}`} style={{ background: t['--color-bg'], fontFamily: t['--font-sans'] }}>
      <div className="flex h-full flex-1 flex-col justify-center gap-1 px-2" style={{ background: t['--color-surface'], borderRadius: t['--radius-md'], border: `1px solid ${t['--color-border']}` }}>
        <span className="text-[11px] font-bold leading-none" style={{ color: t['--color-text'], fontFamily: t['--font-display'] }}>
          Aa
        </span>
        <span className="h-1 w-8 rounded-full" style={{ background: t['--color-brand-ink'] }} />
      </div>
      <span className="px-2 py-1 text-[10px] font-bold" style={{ background: t['--color-brand'], color: t['--color-on-brand'], borderRadius: t['--radius-button'] }}>
        Buy
      </span>
    </div>
  )
}
