// The signed-in hint (src/lib/sessionHint.ts): a signed-out visitor's page load skips the session
// restore, which otherwise answered 401 on every page and showed as a red console error; a visitor we
// know nothing about, or whose browser refuses storage, still gets the restore, as before.
//
// Run: npm test
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const store = new Map<string, string>()
let refuse = false
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => {
    if (refuse) throw new Error('SecurityError')
    return store.get(k) ?? null
  },
  setItem: (k: string, v: string) => {
    if (refuse) throw new Error('SecurityError')
    store.set(k, v)
  },
}
const { readSessionHint, writeSessionHint, shouldTryRestore } = await import('../src/lib/sessionHint.ts')

describe('the session restore on page load', () => {
  beforeEach(() => {
    store.clear()
    refuse = false
  })

  it('is tried for a visitor we know nothing about yet', () => {
    assert.equal(readSessionHint(), 'unknown')
    assert.equal(shouldTryRestore(readSessionHint()), true)
  })

  it('is skipped once we know the visitor is signed out, so no 401 is logged', () => {
    writeSessionHint(false)
    assert.equal(shouldTryRestore(readSessionHint()), false)
  })

  it('is tried again after signing in', () => {
    writeSessionHint(false)
    writeSessionHint(true)
    assert.equal(shouldTryRestore(readSessionHint()), true)
  })

  it('is tried when the browser refuses storage, exactly as before', () => {
    refuse = true
    writeSessionHint(false)
    assert.equal(readSessionHint(), 'unknown')
    assert.equal(shouldTryRestore(readSessionHint()), true)
  })
})
