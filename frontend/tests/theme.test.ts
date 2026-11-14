// The visitor's theme (src/lib/theme.ts and public/theme-init.js): dark by default, a saved choice
// honoured, System following the device, storage that throws treated as nothing saved, and the
// before-paint script agreeing with the app on every case.
//
// Run: npm test
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { parsePreference, readPreference, resolveTheme, THEME_COLOR, THEME_STORAGE_KEY, writePreference } from '../src/lib/theme.ts'

const memory = (initial?: string) => {
  const data = new Map<string, string>(initial === undefined ? [] : [[THEME_STORAGE_KEY, initial]])
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data }
}
const broken = { getItem: () => { throw new Error('SecurityError') }, setItem: () => { throw new Error('QuotaExceededError') } }

describe('the choice', () => {
  it('is dark when nothing, or nothing valid, is saved', () => {
    for (const v of [null, undefined, '', 'blue', 'DARK', 42]) assert.equal(parsePreference(v), 'dark', String(v))
  })
  it('honours a saved dark, light or system', () => {
    for (const v of ['dark', 'light', 'system'] as const) assert.equal(parsePreference(v), v)
  })
  it('System follows the device; Dark and Light ignore it', () => {
    assert.equal(resolveTheme('system', true), 'light')
    assert.equal(resolveTheme('system', false), 'dark')
    assert.equal(resolveTheme('dark', true), 'dark')
    assert.equal(resolveTheme('light', false), 'light')
  })
})

describe('storage', () => {
  it('reads and writes the saved choice', () => {
    const s = memory()
    assert.equal(writePreference(() => s, 'light'), true)
    assert.equal(s.data.get(THEME_STORAGE_KEY), 'light')
    assert.equal(readPreference(() => s), 'light')
  })
  it('storage that throws (a private window, blocked site data) is the default, never an error', () => {
    assert.equal(readPreference(() => broken), 'dark')
    assert.equal(writePreference(() => broken, 'light'), false)
    assert.equal(readPreference(() => { throw new Error('no localStorage') }), 'dark')
    assert.equal(writePreference(() => null, 'light'), false)
  })
})

// public/theme-init.js, run as the browser would run it, with a stand-in page.
function runInit(storage: { getItem: (k: string) => string | null } | null, deviceLight: boolean | 'throws') {
  const attrs: Record<string, string> = {}
  const meta: Record<string, string> = { content: '#030407' }
  const root = { setAttribute: (k: string, v: string) => void (attrs[k] = v), style: {} as Record<string, string> }
  const window = {
    get localStorage() {
      if (!storage) throw new Error('SecurityError')
      return storage
    },
    matchMedia: () => {
      if (deviceLight === 'throws') throw new Error('no matchMedia')
      return { matches: deviceLight }
    },
  }
  const document = { documentElement: root, querySelector: () => ({ setAttribute: (k: string, v: string) => void (meta[k] = v) }) }
  runInNewContext(readFileSync(new URL('../public/theme-init.js', import.meta.url), 'utf8'), { window, document })
  return { theme: attrs['data-theme'], scheme: root.style.colorScheme, themeColor: meta.content }
}

describe('the before-paint script', () => {
  const cases: [string | undefined, boolean | 'throws'][] = [
    [undefined, false],
    [undefined, true],
    ['dark', true],
    ['light', false],
    ['system', true],
    ['system', false],
    ['system', 'throws'],
    ['nonsense', true],
  ]
  for (const [saved, device] of cases) {
    it(`saved ${saved ?? 'nothing'}, device ${device === true ? 'light' : device === false ? 'dark' : 'unknown'}: the same theme as the app`, () => {
      const expected = resolveTheme(readPreference(() => memory(saved)), device === true)
      const got = runInit(memory(saved), device)
      assert.equal(got.theme, expected)
      assert.equal(got.scheme, expected)
      assert.equal(got.themeColor, THEME_COLOR[expected])
    })
  }
  it('storage that throws gives the dark default, with no error', () => {
    assert.equal(runInit(null, true).theme, 'dark')
  })
})
