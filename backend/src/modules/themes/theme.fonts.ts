/**
 * The font pairs a store theme may use (Store Themes, 2026-11). A theme names a pair by its id and
 * nothing else, so no font name, URL or CSS can reach a storefront from an owner or the AI. Every family
 * is self-hosted by the frontend (src/lib/themeFonts.ts, @fontsource packages under the SIL Open Font
 * License), because the site's Content-Security-Policy allows fonts from its own origin only.
 *
 *   sans     body and interface text
 *   display  headings
 *   serif    the large hero headline (italic)
 */
export const FONT_PAIRS = {
  "jakarta-instrument": { label: "Zyro (Plus Jakarta Sans and Instrument Serif)", mood: "modern, clean", sans: "Plus Jakarta Sans", display: "Plus Jakarta Sans", serif: "Instrument Serif" },
  "inter-clean": { label: "Clean (Inter)", mood: "simple, neutral, technical", sans: "Inter", display: "Inter", serif: "Inter" },
  "poppins-bold": { label: "Bold (Poppins)", mood: "bold, geometric, energetic", sans: "Poppins", display: "Poppins", serif: "Poppins" },
  "nunito-friendly": { label: "Friendly (Nunito)", mood: "soft, rounded, playful, for children", sans: "Nunito", display: "Nunito", serif: "Nunito" },
  "dmsans-playfair": { label: "Elegant (DM Sans and Playfair Display)", mood: "elegant, luxury, fashion", sans: "DM Sans", display: "Playfair Display", serif: "Playfair Display" },
  "inter-lora": { label: "Classic (Inter and Lora)", mood: "classic, warm, editorial, handmade", sans: "Inter", display: "Lora", serif: "Lora" },
} as const;

export type FontPairId = keyof typeof FONT_PAIRS;
export const FONT_PAIR_IDS = Object.keys(FONT_PAIRS) as [FontPairId, ...FontPairId[]];

/** A CSS font-family stack for a family, ending in generic fallbacks. Families come only from FONT_PAIRS. */
export function fontStack(family: string, generic: "sans-serif" | "serif"): string {
  return generic === "serif" ? `"${family}", ui-serif, Georgia, serif` : `"${family}", ui-sans-serif, system-ui, "Segoe UI", sans-serif`;
}
