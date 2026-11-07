// The shopping assistant's conversation id (src/lib/assistantId.ts): kept for one browser so a reload
// continues the chat, and forgotten when the person signed in changes, so the next person on a shared
// browser does not continue the previous shopper's conversation (audit 2026-11).
//
// Run: npm test
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}
const { getConversationId, forgetConversation } = await import('../src/lib/assistantId.ts')

describe('the conversation id', () => {
  beforeEach(() => store.clear())

  it('stays the same across calls, so a reload continues the chat', () => {
    assert.equal(getConversationId(), getConversationId())
  })

  it('is replaced after it is forgotten (sign-out or sign-in)', () => {
    const first = getConversationId()
    forgetConversation()
    const second = getConversationId()
    assert.notEqual(second, first)
    assert.match(second, /^[0-9a-f]{32}$/)
  })
})
