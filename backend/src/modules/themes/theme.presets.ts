import { SECTION_IDS, type Theme } from "./theme.schema";

/**
 * Ready-made starting points for a store theme (Store Themes, 2026-11). This file and the platform's
 * src/index.css are the only places a theme's colours are written down. Each one passes the contrast
 * guard unchanged (tests/unit/themes.test.ts), so picking a preset never produces a correction.
 */

const allSections = (): Theme["sections"] => SECTION_IDS.map((id) => ({ id, visible: true }));

const base = {
  version: 1 as const,
  logoUrl: null,
  bannerUrl: null,
  heroHeadline: null,
  heroText: null,
  aboutText: null,
};

export const PRESETS: Record<string, { name: string; description: string; theme: Theme }> = {
  "dark-lime": {
    name: "Dark Lime",
    description: "Zyro's own look: deep black with a sharp lime.",
    theme: { ...base, preset: "dark-lime", colors: { primary: "#d4ff24", accent: "#d4ff24", background: "#030407", text: "#f4f5f0" }, surfaceStyle: "raised", font: "jakarta-instrument", radius: "medium", buttonStyle: "pill", cardStyle: "bordered", sections: allSections(), footerStyle: "simple" },
  },
  "clean-light": {
    name: "Clean Light",
    description: "White and calm, so the products do the talking.",
    theme: { ...base, preset: "clean-light", colors: { primary: "#1f4fd1", accent: "#0e6f67", background: "#ffffff", text: "#111827" }, surfaceStyle: "raised", font: "inter-clean", radius: "small", buttonStyle: "rounded", cardStyle: "bordered", sections: allSections(), footerStyle: "detailed" },
  },
  "warm-earth": {
    name: "Warm Earth",
    description: "Clay, sand and terracotta, for handmade and home goods.",
    theme: { ...base, preset: "warm-earth", colors: { primary: "#9a3412", accent: "#845006", background: "#f6efe6", text: "#2b1d14" }, surfaceStyle: "raised", font: "inter-lora", radius: "medium", buttonStyle: "rounded", cardStyle: "flat", sections: allSections(), footerStyle: "detailed" },
  },
  "soft-pastel": {
    name: "Soft Pastel",
    description: "Gentle pinks and lilacs, friendly and light, for children's and gift shops.",
    theme: { ...base, preset: "soft-pastel", colors: { primary: "#a9306b", accent: "#7247bc", background: "#fff5f9", text: "#3b2440" }, surfaceStyle: "raised", font: "nunito-friendly", radius: "large", buttonStyle: "pill", cardStyle: "shadow", sections: allSections(), footerStyle: "simple" },
  },
  "bold-contrast": {
    name: "Bold Contrast",
    description: "Black, white and one loud colour, for fashion and streetwear.",
    theme: { ...base, preset: "bold-contrast", colors: { primary: "#ff5a51", accent: "#ffd60a", background: "#0a0a0a", text: "#ffffff" }, surfaceStyle: "contrast", font: "poppins-bold", radius: "none", buttonStyle: "square", cardStyle: "bordered", sections: allSections(), footerStyle: "minimal" },
  },
};

export const DEFAULT_PRESET = "dark-lime";

/** A store's theme before its owner has made one: Dark Lime, wearing the colour and logo it already has. */
export function defaultThemeFor(store: { themeColor: string | null }): Theme {
  const theme = structuredClone(PRESETS[DEFAULT_PRESET].theme);
  if (store.themeColor && /^#[0-9a-fA-F]{6}$/.test(store.themeColor)) theme.colors.primary = store.themeColor.toLowerCase();
  return theme;
}
