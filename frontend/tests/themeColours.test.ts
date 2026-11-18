// Store Themes, Part 3: no colour is written down in the Theme Studio or the themed storefront code.
// Colours live in src/index.css (Zyro's tokens) and in the backend's theme presets; everything here
// reads tokens (bg-bg, text-brand-ink...) or a store's own token values. A hex, rgb(), hsl() or oklch()
// literal in these files would be a colour that ignores both the platform theme and the shop's.
//
// Run: npm test
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const src = new URL('../src/', import.meta.url)
const studio = readdirSync(new URL('pages/admin/theme/', src)).map((f) => `pages/admin/theme/${f}`)
const files = [
  ...studio,
  'lib/storeTheme.ts',
  'lib/themePreview.ts',
  'lib/themeFonts.ts',
  'lib/themeApi.ts',
  'lib/logoColors.ts',
  'pages/storefront/StorefrontLayout.tsx',
  'pages/storefront/StorefrontHome.tsx',
]
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch)\(/

describe('no hard-coded colours in the Store Themes code', () => {
  for (const file of files) {
    it(file, () => {
      const code = readFileSync(new URL(file, src), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      const hit = code.split('\n').find((line) => COLOUR.test(line))
      assert.equal(hit, undefined, `colour literal in ${file}: ${hit?.trim()}`)
    })
  }
})
