import { safeTokens, SECTION_IDS, type PublishedTheme, type StoreTheme } from './storeTheme.ts'

/**
 * How the Theme Studio shows the owner's draft on the real storefront (Store Themes, Part 2).
 *
 * The Studio frames the storefront (same site only: X-Frame-Options SAMEORIGIN, frame-ancestors 'self')
 * and hands it the draft with postMessage on every change, so the preview updates without reloading.
 * The storefront never fetches a draft: the draft only exists in the owner's own Studio window, and a
 * storefront takes a preview message only when it is framed by the Studio page of the same site. A
 * shopper opening any storefront address therefore always sees the published theme.
 */

export const PREVIEW_MESSAGE = 'zyro-theme-preview'
export const PREVIEW_READY = 'zyro-theme-preview-ready'
/** The Studio's address; only a storefront framed by this page shows a draft. */
export const STUDIO_PATH = '/admin/theme'

/** True when this storefront is inside the Theme Studio's preview frame on the same site. */
export function isStudioPreview(win: Window = window): boolean {
  try {
    if (win.parent === win) return false
    return win.parent.location.origin === win.location.origin && win.parent.location.pathname.startsWith(STUDIO_PATH)
  } catch {
    return false // a parent on another site: reading its location throws, and it gets nothing
  }
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null)

/**
 * A preview message read defensively: tokens through the same allowlist as a published theme, texts
 * as plain strings with limits, sections from the fixed list. Anything else is null.
 */
export function readPreviewMessage(data: unknown): PublishedTheme | null {
  if (!data || typeof data !== 'object') return null
  const msg = data as { type?: unknown; theme?: Record<string, unknown>; tokens?: unknown }
  if (msg.type !== PREVIEW_MESSAGE || !msg.theme || typeof msg.theme !== 'object') return null
  const tokens = safeTokens(msg.tokens)
  if (Object.keys(tokens).length === 0) return null
  const t = msg.theme
  const sections = Array.isArray(t.sections)
    ? (t.sections as { id: unknown; visible: unknown }[])
        .filter((s) => SECTION_IDS.includes(s?.id as never))
        .map((s) => ({ id: s.id as StoreTheme['sections'][number]['id'], visible: s.visible === true }))
    : []
  const image = (v: unknown) => (typeof v === 'string' && /^https?:\/\/[^\s"'<>]+$/.test(v) ? v.slice(0, 500) : null)
  const theme = {
    ...(t as unknown as StoreTheme),
    sections,
    logoUrl: image(t.logoUrl),
    bannerUrl: image(t.bannerUrl),
    heroHeadline: text(t.heroHeadline, 80),
    heroText: text(t.heroText, 200),
    aboutText: text(t.aboutText, 600),
    footerStyle: (['simple', 'detailed', 'minimal'] as const).includes(t.footerStyle as never) ? (t.footerStyle as StoreTheme['footerStyle']) : 'simple',
  }
  return { theme, tokens }
}
