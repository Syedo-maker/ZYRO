// A merchant's own colour in both themes (src/lib/brandTheme.ts, B5): whatever colour is chosen, the
// shop stays readable. Dark: the colour is lightened until it reads on the dark page. Light: it fills
// buttons exactly as chosen, with black or white on it, and its ink (text, lines) is darkened until it
// reads on the lightest page.
//
// Run: npm test
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { brandColours, brandStyle, contrast } from '../src/lib/brandTheme.ts'

const SAMPLES = ['#000080', '#e8703d', '#ffff00', '#0b3b33', '#ffffff', '#000000', '#ff00ff', '#7f7f7f', '#d4ff24', '#3cc98e']
const LIGHT_SURFACES = ['#ffffff', '#f4f5f0', '#e9ebe3']
const DARK_SURFACE = '#15181e'

describe('the light theme', () => {
  for (const colour of SAMPLES) {
    it(`${colour}: the fill is the colour as chosen, and its ink reads on every light surface`, () => {
      const c = brandColours(colour, 'light')!
      assert.equal(c.brand, colour)
      assert.ok(contrast(c.onBrand, c.brand) >= 4.5, `text on the fill ${contrast(c.onBrand, c.brand).toFixed(2)}`)
      for (const s of LIGHT_SURFACES) assert.ok(contrast(c.brandInk, s) >= 4.5, `ink on ${s}: ${contrast(c.brandInk, s).toFixed(2)}`)
      assert.ok(contrast(c.brandInk, c.brandSoft) >= 4.5, 'ink on its soft tint')
      assert.ok(contrast(c.brandInkHover, '#ffffff') >= contrast(c.brandInk, '#ffffff'), 'hover is no lighter than the ink')
    })
  }
  it('a colour dark enough already is used as its own ink', () => {
    assert.equal(brandColours('#000080', 'light')!.brandInk, '#000080')
  })
})

describe('the dark theme, as before', () => {
  for (const colour of SAMPLES) {
    it(`${colour}: brand text reads on the dark surfaces, and the ink is the brand colour`, () => {
      const c = brandColours(colour)!
      assert.ok(contrast(c.brand, DARK_SURFACE) >= 4.5)
      assert.equal(c.brandInk, c.brand)
      assert.ok(contrast(c.onBrand, c.brand) >= 4.5)
    })
  }
})

describe('the style', () => {
  it('sets the ink tokens with the fill tokens, for the theme asked for', () => {
    const style = brandStyle('#000080', 'light') as Record<string, string>
    assert.equal(style['--color-brand'], '#000080')
    assert.equal(style['--color-brand-ink'], '#000080')
    assert.ok(style['--color-brand-ink-hover'])
  })
  it('no valid colour keeps ZYRO\'s own', () => {
    assert.equal(brandStyle(null, 'light'), undefined)
    assert.equal(brandStyle('red', 'dark'), undefined)
  })
})
