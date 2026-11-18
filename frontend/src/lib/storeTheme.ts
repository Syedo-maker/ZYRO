import type { CSSProperties } from 'react'

/**
 * A store's own theme on its storefront (Store Themes, 2026-11).
 *
 * The server builds the theme into a map of design tokens (backend/src/modules/themes/theme.tokens.ts),
 * already checked for WCAG AA. The storefront sets those tokens on its root element and nothing else:
 * every utility reads `var(--color-*)` and friends at run time (src/index.css), so the whole shop
 * changes while no CSS, HTML or font file is ever taken from a theme. As a second wall, this file
 * re-checks every name and value against an allowlist before it reaches the page, so even a damaged
 * or tampered response (or a damaged cache) cannot set anything else.
 *
 * The platform (dashboard, sign-in, landing) never calls this: it keeps Zyro's own look.
 */

export const SECTION_IDS = ['hero', 'featured', 'categories', 'reviews', 'about'] as const
export type SectionId = (typeof SECTION_IDS)[number]
export type FontPairId = 'jakarta-instrument' | 'inter-clean' | 'poppins-bold' | 'nunito-friendly' | 'dmsans-playfair' | 'inter-lora'

export interface StoreTheme {
  version: 1
  preset: string | null
  colors: { primary: string; accent: string; background: string; text: string }
  surfaceStyle: 'flat' | 'raised' | 'contrast'
  font: FontPairId
  radius: 'none' | 'small' | 'medium' | 'large'
  buttonStyle: 'pill' | 'rounded' | 'square'
  cardStyle: 'flat' | 'bordered' | 'shadow'
  logoUrl: string | null
  bannerUrl: string | null
  sections: { id: SectionId; visible: boolean }[]
  footerStyle: 'simple' | 'detailed' | 'minimal'
  heroHeadline: string | null
  heroText: string | null
  aboutText: string | null
}

export type ThemeTokens = Record<string, string>

/** The published theme as the public store profile carries it. */
export interface PublishedTheme {
  theme: StoreTheme
  tokens: ThemeTokens
}

const NAME = /^--(color|font|radius|shadow)-[a-z0-9-]{1,40}$/
// Colours, lengths, shadows and font stacks only: letters, digits, spaces and a few punctuation
// marks. No semicolons, braces, angle brackets, backslashes, url() or expression().
const VALUE = /^[#a-zA-Z0-9 .,%()/"'-]{1,160}$/
const FORBIDDEN = /url\s*\(|expression|javascript|@import|\\/i

/** Only allowlisted token names with plain values survive. */
export function safeTokens(tokens: unknown): ThemeTokens {
  const out: ThemeTokens = {}
  if (!tokens || typeof tokens !== 'object') return out
  for (const [name, value] of Object.entries(tokens as Record<string, unknown>)) {
    if (name === 'color-scheme') {
      if (value === 'dark' || value === 'light') out[name] = value
      continue
    }
    if (typeof value !== 'string' || !NAME.test(name) || !VALUE.test(value) || FORBIDDEN.test(value)) continue
    out[name] = value
  }
  return out
}

/**
 * The style for a storefront's root element: the tokens, plus the two properties that are resolved
 * where they are declared rather than where they are used (the body font and the page colour scheme),
 * so the root has to name them itself for them to follow the theme.
 */
export function themeStyle(tokens: ThemeTokens): CSSProperties {
  const safe = safeTokens(tokens)
  const style: Record<string, string> = {}
  for (const [name, value] of Object.entries(safe)) {
    if (name === 'color-scheme') style.colorScheme = value
    else style[name] = value
  }
  if (safe['--font-sans']) style.fontFamily = 'var(--font-sans)'
  return style as CSSProperties
}

/** Sections in the owner's order, hidden ones left out. A damaged list falls back to every section. */
export function visibleSections(theme: Pick<StoreTheme, 'sections'> | null | undefined): SectionId[] {
  const list = theme?.sections
  if (!Array.isArray(list) || list.length === 0) return [...SECTION_IDS]
  const seen = new Set<string>()
  return list.filter((s) => SECTION_IDS.includes(s?.id) && !seen.has(s.id) && seen.add(s.id) && s.visible).map((s) => s.id)
}

// ---- The no-flash cache ----
// A returning shopper's browser remembers the last theme it saw for each store, so the loading screen
// and the first frame already wear the shop's colours instead of flashing Zyro's. The server's answer
// replaces it as soon as it arrives. Kept per store, in this browser only; a browser that refuses
// storage simply goes without.

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const cacheKey = (storeId: string) => `zyro-store-theme:${storeId}`

export function readCachedTokens(storeId: string, storage: Store | undefined = globalThis.localStorage): ThemeTokens | null {
  try {
    const raw = storage?.getItem(cacheKey(storeId))
    if (!raw) return null
    const tokens = safeTokens(JSON.parse(raw))
    return Object.keys(tokens).length > 0 ? tokens : null
  } catch {
    return null
  }
}

export function writeCachedTokens(storeId: string, tokens: ThemeTokens | null, storage: Store | undefined = globalThis.localStorage) {
  try {
    if (tokens) storage?.setItem(cacheKey(storeId), JSON.stringify(safeTokens(tokens)))
    else storage?.removeItem(cacheKey(storeId))
  } catch {
    // Private window or blocked storage: the shop still renders, just without the head start.
  }
}
