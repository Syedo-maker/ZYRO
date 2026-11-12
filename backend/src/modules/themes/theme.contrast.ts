/**
 * Colour arithmetic for store themes (Store Themes, 2026-11): the WCAG 2.2 contrast ratio, mixing,
 * and the smallest change that makes a colour readable on its backgrounds. Pure functions on
 * six-digit hex strings, so the contrast guard can be tested on its own.
 */

type Rgb = [number, number, number];

export const BLACK = "#000000";
export const WHITE = "#ffffff";

const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const toHex = (rgb: Rgb) => "#" + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");

/** `a` moved towards `b` by `t` (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as Rgb);
}

export function luminance(hex: string): number {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = toRgb(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** The WCAG 2.2 contrast ratio between two colours, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

export const isDark = (hex: string) => luminance(hex) < 0.18;

/** Black or white, whichever reads better on `fill`. One of them always reaches 4.5:1. */
export function textOn(fill: string): string {
  return contrast(BLACK, fill) >= contrast(WHITE, fill) ? BLACK : WHITE;
}

/** The lowest contrast `fg` has against any of `backgrounds`. */
export const worstContrast = (fg: string, backgrounds: string[]) => Math.min(...backgrounds.map((b) => contrast(fg, b)));

/**
 * `fg` made readable on every one of `backgrounds` (ratio at least `min`) with the smallest change:
 * moved towards black or white, keeping its hue, in steps of 2%. Unchanged if it already passes.
 * Towards whichever end reads better on the backgrounds; black or white itself is the last resort.
 */
export function ensureContrast(fg: string, backgrounds: string[], min: number): string {
  if (worstContrast(fg, backgrounds) >= min) return fg;
  const target = worstContrast(BLACK, backgrounds) >= worstContrast(WHITE, backgrounds) ? BLACK : WHITE;
  for (let step = 1; step <= 50; step++) {
    const candidate = mix(fg, target, step / 50);
    if (worstContrast(candidate, backgrounds) >= min) return candidate;
  }
  return target;
}
