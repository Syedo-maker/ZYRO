import type { CSSProperties } from 'react'
import type { Theme } from './theme'

/**
 * A storefront wears its merchant's own colour; the platform around it stays ZYRO's.
 *
 * The brand tokens (--color-brand and friends, src/index.css) are CSS variables that every utility
 * reads at run time, so setting them on a storefront's root element re-colours everything inside it.
 * What this file adds is the guarantee: a merchant can pick any colour in settings, including a deep
 * navy that would vanish on the dark page, and the shop must still be readable. So the colour is
 * lightened, keeping its hue, only as far as it has to be for brand-coloured text to reach 4.5:1 on
 * the lightest dark surface it sits on and on its own soft tint; the text on a brand button is black
 * or white, whichever reads better (always at least 4.5:1). A colour that already passes is used
 * exactly as the merchant chose it.
 *
 * On the light theme (B5) the problem turns around: the merchant's colour fills buttons exactly as
 * chosen, with black or white text, and the "ink" (brand-coloured text, lines and rings) is darkened,
 * keeping its hue, until it reaches 4.5:1 on the darkest light surface and on its own soft tint.
 */

export interface BrandColours {
  brand: string
  brandHover: string
  brandSoft: string
  onBrand: string
  /** The colour as text, a line or a ring on the page (the same as `brand` on the dark theme). */
  brandInk: string
  brandInkHover: string
}

const HEX = /^#[0-9a-f]{6}$/i
// --zyro-night-700, the lightest surface brand-coloured text sits on (passing there covers the
// page and the cards, which are darker), and --zyro-black, the page a soft tint is mixed towards.
const SURFACE = '#15181e'
const PAGE = '#030407'
// --zyro-paper-subtle, the darkest light surface brand-coloured text sits on.
const LIGHT_SURFACE = '#e9ebe3'
const WHITE = '#ffffff'
const BLACK = '#030407'
const MIN = 4.5

type Rgb = [number, number, number]

const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb
const toHex = (rgb: Rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as Rgb

function luminance([r, g, b]: Rgb) {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** The WCAG 2.2 contrast ratio between two colours. */
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(toRgb(a)), luminance(toRgb(b))].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

/** The merchant's colour, made safe to use; null when there is no valid colour to use. */
export function brandColours(themeColor: string | null | undefined, theme: Theme = 'dark'): BrandColours | null {
  if (!themeColor || !HEX.test(themeColor)) return null
  const base = toRgb(themeColor.toLowerCase())
  const white: Rgb = [255, 255, 255]
  if (theme === 'light') return lightBrandColours(base)

  // Mixing towards white raises luminance at every step, so the first step that passes is the
  // smallest change that does. 100 steps of 1% is fine-grained enough to be invisible.
  for (let step = 0; step <= 100; step++) {
    const brand = toHex(mix(base, white, step / 100))
    const brandSoft = toHex(mix(toRgb(brand), toRgb(PAGE), 0.86))
    if (contrast(brand, SURFACE) >= MIN && contrast(brand, brandSoft) >= MIN) {
      return {
        brand,
        brandHover: toHex(mix(toRgb(brand), white, 0.18)),
        brandSoft,
        onBrand: contrast(BLACK, brand) >= contrast(WHITE, brand) ? BLACK : WHITE,
        brandInk: brand,
        brandInkHover: toHex(mix(toRgb(brand), white, 0.18)),
      }
    }
  }
  return null // unreachable: white passes every check
}

function lightBrandColours(base: Rgb): BrandColours {
  const black = toRgb(BLACK)
  const white: Rgb = [255, 255, 255]
  const fill = toHex(base)
  // Mixing towards black lowers luminance at every step, so the first step that passes is the
  // smallest change that does; black itself passes everything.
  for (let step = 0; step <= 100; step++) {
    const ink = toHex(mix(base, black, step / 100))
    const brandSoft = toHex(mix(toRgb(ink), white, 0.88))
    if (contrast(ink, LIGHT_SURFACE) >= MIN && contrast(ink, brandSoft) >= MIN) {
      return {
        brand: fill,
        brandHover: toHex(mix(base, black, 0.12)),
        brandSoft,
        onBrand: contrast(BLACK, fill) >= contrast(WHITE, fill) ? BLACK : WHITE,
        brandInk: ink,
        brandInkHover: toHex(mix(toRgb(ink), [0, 0, 0], 0.25)), // never lighter than the ink
      }
    }
  }
  return { brand: fill, brandHover: fill, brandSoft: '#ffffff', onBrand: BLACK, brandInk: BLACK, brandInkHover: BLACK } // unreachable
}

/** The style for a storefront's root element, for the theme on screen; undefined keeps Zyro's own lime. */
export function brandStyle(themeColor: string | null | undefined, theme: Theme = 'dark'): CSSProperties | undefined {
  const c = brandColours(themeColor, theme)
  if (!c) return undefined
  return {
    '--color-brand': c.brand,
    '--color-brand-hover': c.brandHover,
    '--color-brand-soft': c.brandSoft,
    '--color-on-brand': c.onBrand,
    '--color-brand-ink': c.brandInk,
    '--color-brand-ink-hover': c.brandInkHover,
  } as CSSProperties
}
