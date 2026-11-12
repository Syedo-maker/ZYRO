// A store theme on the storefront (src/lib/storeTheme.ts): only allowlisted tokens with plain values
// reach the page, the no-flash cache is per store and survives broken storage, and the homepage
// sections follow the owner's order without trusting a damaged list.
//
// Run: npm test
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readCachedTokens, safeTokens, themeStyle, visibleSections, writeCachedTokens } from '../src/lib/storeTheme.ts'

const memory = () => {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data }
}
const broken = {
  getItem: () => { throw new Error('SecurityError') },
  setItem: () => { throw new Error('QuotaExceededError') },
  removeItem: () => { throw new Error('SecurityError') },
}

describe('the token allowlist', () => {
  it('keeps design tokens with plain values', () => {
    const tokens = { '--color-bg': '#ffffff', '--font-sans': '"Inter", ui-sans-serif, system-ui, "Segoe UI", sans-serif', '--shadow-md': '0 8px 24px -10px rgb(3 4 7 / 0.16)', 'color-scheme': 'light' }
    assert.deepEqual(safeTokens(tokens), tokens)
  })

  it('drops anything that is not a design token, or carries CSS, markup or a URL', () => {
    const out = safeTokens({
      background: 'red',
      '--zyro-black': '#000000',
      '--color-bg': '#fff; background:url(https://evil.example/x.png)',
      '--color-text': 'url(javascript:alert(1))',
      '--color-brand': 'expression(alert(1))',
      '--color-ring': '</style><script>alert(1)</script>',
      '--font-sans': '"Inter" \\3c',
      '--color-surface': 12,
      'color-scheme': 'dark; color: red',
      '--color-subtle': '#f4f4f4',
    })
    assert.deepEqual(out, { '--color-subtle': '#f4f4f4' })
  })

  it('tolerates nonsense', () => {
    for (const v of [null, undefined, 'tokens', 42, []]) assert.deepEqual(safeTokens(v), {})
  })

  it('sets the body font and colour scheme on the root, which a variable alone would not change', () => {
    const style = themeStyle({ '--font-sans': '"Poppins", sans-serif', 'color-scheme': 'dark', '--color-bg': '#0a0a0a' }) as Record<string, string>
    assert.equal(style.fontFamily, 'var(--font-sans)')
    assert.equal(style.colorScheme, 'dark')
    assert.equal(style['--color-bg'], '#0a0a0a')
  })
})

describe('the no-flash cache', () => {
  it('remembers each store separately, and forgets a store whose theme was removed', () => {
    const s = memory()
    writeCachedTokens('store-a', { '--color-bg': '#ffffff' }, s)
    writeCachedTokens('store-b', { '--color-bg': '#000000' }, s)
    assert.deepEqual(readCachedTokens('store-a', s), { '--color-bg': '#ffffff' })
    assert.deepEqual(readCachedTokens('store-b', s), { '--color-bg': '#000000' })
    writeCachedTokens('store-a', null, s)
    assert.equal(readCachedTokens('store-a', s), null)
  })

  it('filters a tampered cache the same way as a response', () => {
    const s = memory()
    s.setItem('zyro-store-theme:store-a', JSON.stringify({ '--color-bg': 'red;}body{display:none', 'position': 'fixed' }))
    assert.equal(readCachedTokens('store-a', s), null)
    s.setItem('zyro-store-theme:store-a', '{not json')
    assert.equal(readCachedTokens('store-a', s), null)
  })

  it('a browser that refuses storage just goes without', () => {
    assert.equal(readCachedTokens('store-a', broken), null)
    assert.doesNotThrow(() => writeCachedTokens('store-a', { '--color-bg': '#ffffff' }, broken))
  })
})

describe('the homepage sections', () => {
  it('follow the owner order and leave hidden ones out', () => {
    const sections = [
      { id: 'about', visible: true },
      { id: 'hero', visible: true },
      { id: 'reviews', visible: false },
      { id: 'featured', visible: true },
      { id: 'categories', visible: false },
    ] as const
    assert.deepEqual(visibleSections({ sections: [...sections] }), ['about', 'hero', 'featured'])
  })

  it('ignore unknown and repeated sections, and fall back to all of them when the list is missing', () => {
    const odd = [{ id: 'script', visible: true }, { id: 'hero', visible: true }, { id: 'hero', visible: true }] as never
    assert.deepEqual(visibleSections({ sections: odd }), ['hero'])
    assert.deepEqual(visibleSections(null), ['hero', 'featured', 'categories', 'reviews', 'about'])
  })
})
