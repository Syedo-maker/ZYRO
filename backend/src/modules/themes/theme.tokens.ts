import { BLACK, WHITE, contrast, ensureContrast, isDark, mix, textOn, worstContrast } from "./theme.contrast";
import { FONT_PAIRS, fontStack } from "./theme.fonts";
import type { Theme } from "./theme.schema";

/**
 * From a validated theme to the CSS variables a storefront wears (Store Themes, 2026-11), with the
 * contrast guard applied. The storefront applies this map as it is, through the same design tokens the
 * rest of Zyro uses (src/index.css), so a theme can change nothing but those values. Every colour
 * pairing the storefront uses is checked here, and anything the owner chose that would fail WCAG AA is
 * corrected and reported in plain words.
 *
 *   text, links, prices and status words   at least 4.5:1 on every surface they sit on
 *   button text on the button colour       at least 4.5:1 (black or white, whichever reads better)
 *   input borders and the focus ring       at least 3:1
 */

export interface Correction {
  field: "background" | "text" | "primary" | "accent";
  from: string;
  to: string;
  message: string;
}

export interface Derived {
  /** The theme, with any colour the owner chose that failed AA replaced by its corrected value. */
  theme: Theme;
  /** CSS custom property name to value. Only names from TOKEN_NAMES, only colours, lengths and font stacks. */
  tokens: Record<string, string>;
  corrections: Correction[];
  /** Every pairing that was checked, with its ratio, so tests (and the Studio) can show them. */
  checks: { pair: string; ratio: number; min: number }[];
}

// Status colours a store's own palette does not provide: Zyro's, from src/index.css, made readable
// against the store's background by the guard below.
const STATUS = {
  dark: { success: "#3cc98e", warning: "#f2b24a", danger: "#f2736d" },
  light: { success: "#0f6d47", warning: "#875300", danger: "#b3261e" },
};

const RADII = {
  none: { sm: "0.125rem", md: "0.125rem", lg: "0.125rem", xl: "0.125rem", "2xl": "0.125rem", "3xl": "0.125rem", control: "0.125rem" },
  small: { sm: "0.25rem", md: "0.375rem", lg: "0.5rem", xl: "0.5rem", "2xl": "0.625rem", "3xl": "0.75rem", control: "0.375rem" },
  medium: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", "2xl": "1.25rem", "3xl": "1.75rem", control: "0.75rem" },
  large: { sm: "0.5rem", md: "0.75rem", lg: "1rem", xl: "1.25rem", "2xl": "1.75rem", "3xl": "2.25rem", control: "1rem" },
} as const;

export function deriveTheme(input: Theme): Derived {
  const theme: Theme = structuredClone(input);
  const corrections: Correction[] = [];
  const checks: Derived["checks"] = [];

  // A mid-tone background (a bright purple, a mid grey) cannot carry readable text of any colour, and
  // leaves no room for cards and quiet fills. It is moved, keeping its hue, towards the end it is
  // nearer until black or white text has real headroom on it (8:1), enough for every surface made from it.
  let bg = theme.colors.background;
  if (headroom(bg) < 8) {
    const towards = contrast(bg, WHITE) >= contrast(bg, BLACK) ? BLACK : WHITE;
    for (let step = 1; step <= 50 && headroom(bg) < 8; step++) bg = mix(theme.colors.background, towards, step / 50);
    corrections.push({ field: "background", from: theme.colors.background, to: bg, message: `Your background colour left no readable text colour, so it was made ${towards === BLACK ? "darker" : "lighter"}: ${bg}.` });
    theme.colors.background = bg;
  }
  const dark = isDark(bg);

  // Surfaces: the page, cards, quiet fills and raised menus, made from the background and the text.
  const surfaceShift = { flat: 0, raised: 0.04, contrast: 0.08 }[theme.surfaceStyle];
  const surfaceFor = (text: string) => {
    const surface = mix(bg, text, surfaceShift);
    return { surface, subtle: mix(surface, text, 0.05), raised: mix(bg, text, surfaceShift + 0.06) };
  };

  // Body text must read on every surface; surfaces depend on the text, so settle both together.
  let text = theme.colors.text;
  const surfaceList = (t: string) => {
    const s = surfaceFor(t);
    return [bg, s.surface, s.subtle, s.raised];
  };
  for (let i = 0; i < 8 && worstContrast(text, surfaceList(text)) < 4.5; i++) text = ensureContrast(text, surfaceList(text), 4.5);
  // If moving the text keeps moving the surfaces with it, plain black or white settles it.
  if (worstContrast(text, surfaceList(text)) < 4.5) text = worstContrast(BLACK, surfaceList(BLACK)) >= worstContrast(WHITE, surfaceList(WHITE)) ? BLACK : WHITE;
  const { surface, subtle, raised } = surfaceFor(text);
  const surfaces = [bg, surface, subtle, raised];
  if (text !== theme.colors.text) {
    corrections.push({ field: "text", from: theme.colors.text, to: text, message: `Your text colour was hard to read on this background, so it was changed to ${text}.` });
    theme.colors.text = text;
  }

  const secondary = ensureContrast(mix(text, bg, 0.28), surfaces, 4.5);
  const muted = ensureContrast(mix(text, bg, 0.42), surfaces, 4.5);
  const borderInput = ensureContrast(mix(text, bg, 0.5), [bg, surface, subtle], 3);
  const border = mix(bg, text, { flat: 0.06, bordered: 0.14, shadow: 0.08 }[theme.cardStyle]);

  // Brand: the primary colour fills buttons as chosen, with black or white on it. As text (links,
  // prices) it is shifted only as far as needed to read on the surfaces and on its own soft tint.
  const primary = theme.colors.primary;
  const onBrand = textOn(primary);
  const brandHover = hoverFor(primary, onBrand);
  const brandSoft = mix(bg, primary, 0.14);
  const brandInk = ensureContrast(primary, [...surfaces, brandSoft], 4.5);
  if (brandInk !== primary) {
    corrections.push({ field: "primary", from: primary, to: brandInk, message: `Your main colour is too ${dark ? "dark" : "light"} to read as text here, so links and prices use ${brandInk}. Buttons keep ${primary}.` });
  }
  const brandInkHover = mix(brandInk, dark ? WHITE : BLACK, 0.2);

  const accent = theme.colors.accent;
  const onAccent = textOn(accent);
  const accentInk = ensureContrast(accent, surfaces, 4.5);
  if (accentInk !== accent) {
    corrections.push({ field: "accent", from: accent, to: accentInk, message: `Your accent colour is too ${dark ? "dark" : "light"} to read as text here, so accent text uses ${accentInk}. Accent buttons keep ${accent}.` });
  }

  const statusBase = dark ? STATUS.dark : STATUS.light;
  const status = Object.fromEntries(
    (Object.keys(statusBase) as (keyof typeof statusBase)[]).flatMap((name) => {
      const color = ensureContrast(statusBase[name], [bg, surface], 4.5);
      const soft = mix(bg, color, 0.16);
      return [
        [`--color-${name}`, ensureContrast(color, [bg, surface, soft], 4.5)],
        [`--color-${name}-soft`, soft],
      ];
    })
  );

  const fonts = FONT_PAIRS[theme.font];
  const radius = RADII[theme.radius];
  const shadowColor = dark ? "0 0 0" : "3 4 7";
  const shadowMd = theme.cardStyle === "shadow" ? `0 10px 30px -12px rgb(${shadowColor} / ${dark ? 0.75 : 0.22})` : `0 8px 24px -10px rgb(${shadowColor} / ${dark ? 0.6 : 0.16})`;

  const tokens: Record<string, string> = {
    "--color-bg": bg,
    "--color-surface": surface,
    "--color-subtle": subtle,
    "--color-surface-2": raised,
    "--color-inverse": surface,
    "--color-on-inverse": text,
    "--color-on-inverse-secondary": secondary,
    "--color-on-inverse-muted": muted,
    "--color-border": border,
    "--color-border-input": borderInput,
    "--color-text": text,
    "--color-text-secondary": secondary,
    "--color-text-muted": muted,
    "--color-brand": primary,
    "--color-brand-hover": brandHover,
    "--color-brand-soft": brandSoft,
    "--color-on-brand": onBrand,
    "--color-brand-ink": brandInk,
    "--color-brand-ink-hover": brandInkHover,
    "--color-accent": accent,
    "--color-accent-hover": hoverFor(accent, onAccent),
    "--color-accent-pressed": accent,
    "--color-on-accent": onAccent,
    "--color-accent-ink": accentInk,
    "--color-ring": brandInk,
    "--color-ai": primary,
    "--color-ai-soft": brandSoft,
    "--color-ai-ink": brandInk,
    "--color-star": brandInk,
    ...status,
    "--font-sans": fontStack(fonts.sans, "sans-serif"),
    "--font-display": fontStack(fonts.display, fonts.display === fonts.sans ? "sans-serif" : "serif"),
    "--font-serif": fontStack(fonts.serif, fonts.serif === fonts.sans ? "sans-serif" : "serif"),
    "--radius-sm": radius.sm,
    "--radius-md": radius.md,
    "--radius-lg": radius.lg,
    "--radius-xl": radius.xl,
    "--radius-2xl": radius["2xl"],
    "--radius-3xl": radius["3xl"],
    "--radius-control": radius.control,
    "--radius-button": { pill: "9999px", rounded: radius.control, square: "0.125rem" }[theme.buttonStyle],
    "--shadow-sm": `0 1px 2px rgb(${shadowColor} / ${dark ? 0.5 : 0.08})`,
    "--shadow-md": shadowMd,
    "--shadow-lg": `0 24px 60px -20px rgb(${shadowColor} / ${dark ? 0.85 : 0.28})`,
    "--shadow-glow": `0 0 0 1px ${primary}59, 0 10px 32px -10px ${primary}8c`,
    "--shadow-glow-lg": `0 0 0 1px ${primary}66, 0 18px 56px -14px ${primary}99`,
    "color-scheme": dark ? "dark" : "light",
  };

  const check = (pair: string, a: string, b: string, min: number) => checks.push({ pair, ratio: Math.round(contrast(a, b) * 100) / 100, min });
  for (const [name, color] of [["page", bg], ["card", surface], ["subtle", subtle], ["raised", raised]] as const) {
    check(`text on ${name}`, text, color, 4.5);
    check(`secondary text on ${name}`, secondary, color, 4.5);
    check(`muted text on ${name}`, muted, color, 4.5);
    check(`links on ${name}`, brandInk, color, 4.5);
    check(`accent text on ${name}`, accentInk, color, 4.5);
  }
  check("links on the soft brand tint", brandInk, brandSoft, 4.5);
  check("button text on the button", onBrand, primary, 4.5);
  check("button text on the hovered button", onBrand, brandHover, 4.5);
  check("accent button text", onAccent, accent, 4.5);
  for (const surfaceName of ["page", "card", "subtle"] as const) check(`input border on ${surfaceName}`, borderInput, { page: bg, card: surface, subtle }[surfaceName], 3);
  for (const name of ["success", "warning", "danger"]) {
    check(`${name} on page`, status[`--color-${name}`], bg, 4.5);
    check(`${name} on its soft fill`, status[`--color-${name}`], status[`--color-${name}-soft`], 4.5);
  }

  return { theme, tokens, corrections, checks };
}

/** How readable the best possible text (black or white) can be on a background. */
const headroom = (bg: string) => Math.max(contrast(bg, BLACK), contrast(bg, WHITE));

/** A hover shade of a fill that keeps its text readable: up to 12% towards the text's opposite. */
function hoverFor(fill: string, onFill: string): string {
  const towards = onFill === BLACK ? WHITE : BLACK;
  for (let step = 12; step >= 2; step -= 2) {
    const candidate = mix(fill, towards, step / 100);
    if (contrast(onFill, candidate) >= 4.5) return candidate;
  }
  return fill;
}

/** The custom properties a theme may set; the storefront applies nothing outside this list. */
export const TOKEN_NAMES = Object.keys(
  deriveTheme({
    version: 1,
    preset: null,
    colors: { primary: "#d4ff24", accent: "#d4ff24", background: "#030407", text: "#f4f5f0" },
    surfaceStyle: "raised",
    font: "jakarta-instrument",
    radius: "medium",
    buttonStyle: "pill",
    cardStyle: "bordered",
    logoUrl: null,
    bannerUrl: null,
    sections: [],
    footerStyle: "simple",
    heroHeadline: null,
    heroText: null,
    aboutText: null,
  } as unknown as Theme).tokens
);

