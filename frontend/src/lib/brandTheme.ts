import type { CSSProperties } from 'react'

/**
 * A storefront wears its merchant's own colour; the platform around it stays ZYRO's.
 *
 * The brand tokens (--color-brand and friends, src/index.css) are CSS variables that every utility
 * reads at run time, so setting them on a storefront's root element re-colours everything inside it.
 * What this file adds is the guarantee: a merchant can pick any colour in settings, including a pale
 * yellow that white text would vanish on, and the shop must still be readable. So the colour is
 * deepened, keeping its hue, only as far as it has to be for brand-coloured text to reach 4.5:1 on
 * the page, on a card and on its own soft tint, and for white text on a brand button to reach 4.5:1.
 * A colour that already passes is used exactly as the merchant chose it.
 */

export interface BrandColours {
  brand: string
  brandHover: string
  brandSoft: string
  onBrand: string
}

const HEX = /^#[0-9a-f]{6}$/i
const PAGE = '#f4f3ee' // --zyro-cream-50, the lightest-but-one surface brand text sits on
const WHITE = '#ffffff'
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
export function brandColours(themeColor: string | null | undefined): BrandColours | null {
  if (!themeColor || !HEX.test(themeColor)) return null
  const base = toRgb(themeColor.toLowerCase())
  const black: Rgb = [0, 0, 0]
  const white: Rgb = [255, 255, 255]

  // Mixing towards black lowers luminance at every step, so the first step that passes is the
  // smallest change that does. 100 steps of 1% is fine-grained enough to be invisible.
  for (let step = 0; step <= 100; step++) {
    const brand = toHex(mix(base, black, step / 100))
    const brandSoft = toHex(mix(toRgb(brand), white, 0.88))
    // The page is darker than a card, so passing on the page covers the card too.
    if (contrast(brand, PAGE) >= MIN && contrast(brand, brandSoft) >= MIN) {
      return {
        brand,
        brandHover: toHex(mix(toRgb(brand), black, 0.18)),
        brandSoft,
        onBrand: WHITE,
      }
    }
  }
  return null // unreachable: black passes every check
}

/** The style for a storefront's root element; undefined keeps ZYRO's own brand. */
export function brandStyle(themeColor: string | null | undefined): CSSProperties | undefined {
  const c = brandColours(themeColor)
  if (!c) return undefined
  return {
    '--color-brand': c.brand,
    '--color-brand-hover': c.brandHover,
    '--color-brand-soft': c.brandSoft,
    '--color-on-brand': c.onBrand,
  } as CSSProperties
}
