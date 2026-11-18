// The shopping assistant's suggested questions (src/lib/assistantSuggestions.ts): three or four of them,
// and a budget written so the server reads it in the shop's own currency (the same wording is checked
// against the server's budget reader in backend/tests/unit/budget.test.ts).
//
// Run: npm test
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { suggestionsFor } from '../src/lib/assistantSuggestions.ts'

describe('suggested questions', () => {
  it('offers three or four, all different and short enough for a chip', () => {
    for (const currency of ['PKR', 'USD', 'EUR', 'INR']) {
      const list = suggestionsFor(currency)
      assert.ok(list.length >= 3 && list.length <= 4, currency)
      assert.equal(new Set(list).size, list.length)
      for (const s of list) assert.ok(s.length <= 40, s)
    }
  })

  it('the budget question uses a round amount in the shop\'s currency, with its code', () => {
    assert.ok(suggestionsFor('PKR').includes('Something under 3,000 PKR'))
    assert.ok(suggestionsFor('INR').includes('Something under 2,000 INR'))
    assert.ok(suggestionsFor('usd').includes('Something under 50 USD'))
    assert.ok(suggestionsFor('EUR').includes('Something under 50 EUR'))
  })
})
