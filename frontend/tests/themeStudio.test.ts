// The Theme Studio's browser-side helpers: the logo colours read from pixels (src/lib/logoColors.ts),
// and the preview message a framed storefront accepts (src/lib/themePreview.ts), which must never let
// anything but allowlisted tokens and plain, capped texts through.
//
// Run: npm test
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { dominantColours } from '../src/lib/logoColors.ts'
import { isStudioPreview, PREVIEW_MESSAGE, readPreviewMessage } from '../src/lib/themePreview.ts'

const pixels = (...runs: [number, number, number, number, number][]) => {
  const out: number[] = []
  for (const [r, g, b, a, count] of runs) for (let i = 0; i < count; i++) out.push(r, g, b, a)
  return out
}

describe('logo colours', () => {
  it('most common first, transparent pixels ignored, near-duplicates merged', () => {
    const data = pixels([200, 30, 30, 255, 50], [202, 32, 31, 255, 10], [20, 40, 200, 255, 30], [0, 255, 0, 0, 500])
    const colours = dominantColours(data)
    assert.equal(colours.length, 2)
    assert.match(colours[0], /^#c[89a-f]/) // the red, first
    assert.match(colours[1], /^#1/) // then the blue
  })

  it('an empty or fully transparent image gives nothing', () => {
    assert.deepEqual(dominantColours([]), [])
    assert.deepEqual(dominantColours(pixels([255, 255, 255, 0, 20])), [])
  })
})

describe('the preview message', () => {
  const good = {
    type: PREVIEW_MESSAGE,
    tokens: { '--color-bg': '#ffffff', '--color-text': '#111111' },
    theme: { font: 'inter-clean', sections: [{ id: 'hero', visible: true }], heroHeadline: 'Hello', footerStyle: 'detailed', logoUrl: null, bannerUrl: null },
  }

  it('accepts a well-formed draft', () => {
    const read = readPreviewMessage(good)
    assert.ok(read)
    assert.equal(read.tokens['--color-bg'], '#ffffff')
    assert.equal(read.theme.heroHeadline, 'Hello')
    assert.equal(read.theme.footerStyle, 'detailed')
  })

  it('ignores other messages and empty tokens', () => {
    assert.equal(readPreviewMessage({ ...good, type: 'something-else' }), null)
    assert.equal(readPreviewMessage({ ...good, tokens: { position: 'fixed' } }), null)
    assert.equal(readPreviewMessage('zyro-theme-preview'), null)
    assert.equal(readPreviewMessage(null), null)
  })

  it('filters tokens, caps texts, drops unknown sections and unsafe image links', () => {
    const read = readPreviewMessage({
      type: PREVIEW_MESSAGE,
      tokens: { '--color-bg': '#000000', '--color-text': 'red;}body{display:none', background: 'url(x)' },
      theme: {
        sections: [{ id: 'script', visible: true }, { id: 'about', visible: true }],
        heroHeadline: 'x'.repeat(500),
        logoUrl: 'javascript:alert(1)',
        bannerUrl: 'https://cdn.example.com/a b.png',
        footerStyle: 'giant',
      },
    })
    assert.ok(read)
    assert.deepEqual(Object.keys(read.tokens), ['--color-bg'])
    assert.deepEqual(read.theme.sections, [{ id: 'about', visible: true }])
    assert.equal(read.theme.heroHeadline?.length, 80)
    assert.equal(read.theme.logoUrl, null)
    assert.equal(read.theme.bannerUrl, null)
    assert.equal(read.theme.footerStyle, 'simple')
  })
})

describe('when a storefront counts as the Studio preview', () => {
  const win = (parent: unknown, origin = 'https://zyro.app') => ({ location: { origin, pathname: '/store/abc' }, parent }) as unknown as Window

  it('only inside a frame whose parent is the Studio page of the same site', () => {
    const studio = { location: { origin: 'https://zyro.app', pathname: '/admin/theme' } }
    const self = win(null)
    ;(self as unknown as { parent: unknown }).parent = self
    assert.equal(isStudioPreview(self), false) // not framed
    assert.equal(isStudioPreview(win(studio)), true)
    assert.equal(isStudioPreview(win({ location: { origin: 'https://zyro.app', pathname: '/admin/products' } })), false)
    assert.equal(isStudioPreview(win({ location: { origin: 'https://evil.example', pathname: '/admin/theme' } })), false)
    const crossSite = { get location(): never { throw new Error('SecurityError') } }
    assert.equal(isStudioPreview(win(crossSite)), false)
  })
})
