import type { FontPairId } from './storeTheme'

/**
 * The fonts a store theme may use (Store Themes, 2026-11), self-hosted like Zyro's own (src/fonts.ts):
 * the site's Content-Security-Policy allows fonts from its own origin only, and no visitor's browser
 * is sent to a third-party font server. All are under the SIL Open Font License 1.1.
 *
 * Each pair is loaded only when a shop actually uses it, as its own small chunk, so a shopper on a
 * Zyro-styled shop downloads none of them. Zyro's own pair is already loaded by src/fonts.ts.
 * The ids match backend/src/modules/themes/theme.fonts.ts.
 */
const LOADERS: Record<FontPairId, () => Promise<unknown>> = {
  'jakarta-instrument': async () => undefined,
  'inter-clean': () => Promise.all([import('@fontsource/inter/400.css'), import('@fontsource/inter/500.css'), import('@fontsource/inter/600.css'), import('@fontsource/inter/700.css')]),
  'poppins-bold': () => Promise.all([import('@fontsource/poppins/400.css'), import('@fontsource/poppins/500.css'), import('@fontsource/poppins/600.css'), import('@fontsource/poppins/700.css'), import('@fontsource/poppins/800.css')]),
  'nunito-friendly': () => Promise.all([import('@fontsource/nunito/400.css'), import('@fontsource/nunito/600.css'), import('@fontsource/nunito/700.css'), import('@fontsource/nunito/800.css')]),
  'dmsans-playfair': () =>
    Promise.all([
      import('@fontsource/dm-sans/400.css'),
      import('@fontsource/dm-sans/500.css'),
      import('@fontsource/dm-sans/600.css'),
      import('@fontsource/dm-sans/700.css'),
      import('@fontsource/playfair-display/400.css'),
      import('@fontsource/playfair-display/400-italic.css'),
      import('@fontsource/playfair-display/700.css'),
    ]),
  'inter-lora': () =>
    Promise.all([
      import('@fontsource/inter/400.css'),
      import('@fontsource/inter/500.css'),
      import('@fontsource/inter/600.css'),
      import('@fontsource/inter/700.css'),
      import('@fontsource/lora/400.css'),
      import('@fontsource/lora/400-italic.css'),
      import('@fontsource/lora/700.css'),
    ]),
}

const started = new Set<string>()

/** Starts loading a font pair once; unknown ids are ignored. Text shows in the fallback font meanwhile. */
export function loadThemeFont(id: string | null | undefined) {
  if (!id || started.has(id) || !(id in LOADERS)) return
  started.add(id)
  LOADERS[id as FontPairId]().catch(() => started.delete(id))
}
