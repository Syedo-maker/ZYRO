// Every colour pairing the interface uses, measured in both themes straight from src/index.css with the
// WCAG 2.2 formula (B5): text 4.5:1, an input's border, the focus ring and chart marks 3:1. Changing a
// token so that any pairing drops below AA fails here.
//
// Run: npm test
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { contrast } from '../src/lib/brandTheme.ts'

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

/** The custom properties declared directly in the first block that `opener` starts. */
function block(opener: string): Record<string, string> {
  const start = css.indexOf(opener)
  assert.ok(start >= 0, `no ${opener} in index.css`)
  let depth = 0
  let end = start
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) {
      end = i
      break
    }
  }
  const body = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

const primitives = block(':root {')
const dark = { ...primitives, ...block('@theme {') }
const light = { ...dark, ...block(':root[data-theme="light"] {') }

function hex(tokens: Record<string, string>, name: string): string {
  let v = tokens[name]
  for (let i = 0; i < 5 && v?.startsWith('var('); i++) v = tokens[v.slice(4, -1).trim()]
  assert.match(v ?? '', /^#[0-9a-f]{6}$/i, `${name} is not a colour (${tokens[name]})`)
  return v
}

const SURFACES = ['bg', 'surface', 'subtle', 'surface-2']
const TEXT = ['text', 'text-secondary', 'text-muted', 'brand-ink', 'accent-ink', 'ai-ink']
const pairs: [fg: string, bg: string, min: number][] = [
  ...TEXT.flatMap((t) => SURFACES.map((s): [string, string, number] => [t, s, 4.5])),
  ...['on-inverse', 'on-inverse-secondary', 'on-inverse-muted'].map((t): [string, string, number] => [t, 'inverse', 4.5]),
  ['on-brand', 'brand', 4.5],
  ['on-brand', 'brand-hover', 4.5],
  ['on-accent', 'accent', 4.5],
  ['on-accent', 'accent-hover', 4.5],
  ['on-accent', 'accent-pressed', 4.5],
  ['text', 'brand-soft', 4.5],
  ['brand-ink', 'brand-soft', 4.5],
  ['ai-ink', 'ai-soft', 4.5],
  ['success', 'success-soft', 4.5],
  ['warning', 'warning-soft', 4.5],
  ['danger', 'danger-soft', 4.5],
  ['success', 'surface', 4.5],
  ['warning', 'surface', 4.5],
  ['danger', 'surface', 4.5],
  ...SURFACES.map((s): [string, string, number] => ['border-input', s, 3]),
  ['ring', 'bg', 3],
  ['ring', 'surface', 3],
  ['series-online', 'surface', 3],
  ['series-pos', 'surface', 3],
  ['star', 'surface', 3],
]

for (const [name, tokens] of [['dark', dark], ['light', light]] as const) {
  describe(`the ${name} theme`, () => {
    for (const [fg, bg, min] of pairs) {
      it(`${fg} on ${bg} is at least ${min}:1`, () => {
        const ratio = contrast(hex(tokens, `--color-${fg}`), hex(tokens, `--color-${bg}`))
        assert.ok(ratio >= min, `${ratio.toFixed(2)}:1`)
      })
    }
  })
}

describe('the light theme keeps the two-colour rule', () => {
  it('lime is only ever a fill: every ink and the ring are black there', () => {
    for (const t of ['brand-ink', 'accent-ink', 'ai-ink', 'ring', 'star']) assert.equal(hex(light, `--color-${t}`), hex(light, '--zyro-black'), t)
    for (const t of ['brand', 'accent', 'ai']) assert.equal(hex(light, `--color-${t}`), hex(light, '--zyro-lime-400'), t)
  })
  it('success is a green, not the lime, in both themes', () => {
    for (const tokens of [dark, light]) assert.ok(contrast(hex(tokens, '--color-success'), hex(tokens, '--zyro-lime-400')) > 1.5)
  })
})
