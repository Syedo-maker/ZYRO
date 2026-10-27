// The product form's price arithmetic (src/lib/prices.ts): the selling price as MRP minus a discount
// in Rs or %, the rules, and the Rs / % switch. The same cases as the server's copy
// (backend/tests/unit/product-prices.test.ts), so the form never shows a price the server would not save.
//
// Run: npm test (Node's own test runner; Node strips the types itself, so nothing is installed for it).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computePrices, convertDiscount, priceProblem, pricesFromForm, switchDiscountMode, percentLabel, type Discount } from '../src/lib/prices.ts'

const amount = (value: number): Discount => ({ type: 'amount', value })
const percent = (value: number): Discount => ({ type: 'percent', value })

describe('the selling price: MRP minus the discount', () => {
  const cases: [number, Discount | null, number, number][] = [
    // [MRP, discount, discount taken off, selling price]
    [1000, null, 0, 1000],
    [1000, amount(200), 200, 800],
    [999.99, amount(0.99), 0.99, 999],
    [1000, amount(199.999), 200, 800],
    [1000, percent(15), 150, 850],
    [450, percent(12.5), 56.25, 393.75],
    [999, percent(33.33), 332.97, 666.03],
    [100, percent(33.333), 33.33, 66.67],
    [0.05, percent(50), 0.03, 0.02],
  ]
  for (const [mrp, discount, off, sale] of cases) {
    it(`MRP ${mrp} with ${JSON.stringify(discount)}: ${off} off, customers pay ${sale}`, () => {
      const p = computePrices(mrp, discount)
      assert.equal(p.discountAmount, off)
      assert.equal(p.sale, sale)
      assert.equal(Math.round(p.actual * 100) - Math.round(p.discountAmount * 100), Math.round(p.sale * 100))
    })
  }

  it('a discount of zero, in either mode, is no discount', () => {
    assert.deepEqual(computePrices(1000, amount(0)), { actual: 1000, discount: null, discountAmount: 0, sale: 1000 })
    assert.deepEqual(computePrices(1000, percent(0)), { actual: 1000, discount: null, discountAmount: 0, sale: 1000 })
  })
})

describe('the rules', () => {
  const refused: [string, number, Discount | null, string][] = [
    ['an MRP of zero', 0, null, 'The price (MRP) must be more than zero'],
    ['a negative amount', 1000, amount(-1), 'The discount cannot be below zero'],
    ['an amount equal to the MRP', 1000, amount(1000), 'The discount must be less than the price (MRP)'],
    ['100%', 1000, percent(100), 'A percentage discount must be less than 100%'],
    ['a percentage that rounds to 100%', 1000, percent(99.999), 'The selling price must stay above zero'],
    ['a percentage that leaves less than a hundredth', 0.01, percent(50), 'The selling price must stay above zero'],
  ]
  for (const [label, mrp, discount, message] of refused) {
    it(`refuses ${label}`, () => assert.equal(priceProblem(mrp, discount), message))
  }

  it('accepts a discount just under the limit in each mode', () => {
    assert.equal(priceProblem(1000, amount(999.99)), null)
    assert.equal(priceProblem(1000, percent(99.99)), null)
  })
})

describe('the form as the owner types', () => {
  it('shows nothing until there is an MRP, and the MRP when there is no discount', () => {
    assert.deepEqual(pricesFromForm('', 'amount', '200'), { prices: null, problem: null })
    assert.equal(pricesFromForm('1000', 'amount', '').prices?.sale, 1000)
  })

  it('works out the selling price in Rs and in %', () => {
    assert.equal(pricesFromForm('1000', 'amount', '150').prices?.sale, 850)
    assert.equal(pricesFromForm('1000', 'percent', '15').prices?.sale, 850)
    assert.equal(pricesFromForm('999', 'percent', '33.33').prices?.sale, 666.03)
  })

  it('says what is wrong instead of a price', () => {
    assert.deepEqual(pricesFromForm('1000', 'percent', '120'), { prices: null, problem: 'A percentage discount must be less than 100%' })
    assert.deepEqual(pricesFromForm('1000', 'amount', '1000'), { prices: null, problem: 'The discount must be less than the price (MRP)' })
  })
})

describe('the Rs / % switch', () => {
  it('converts both ways', () => {
    assert.equal(convertDiscount(1000, amount(200), 'percent'), 20)
    assert.equal(convertDiscount(1000, percent(20), 'amount'), 200)
    assert.equal(convertDiscount(999, amount(333), 'percent'), 33.33)
    assert.equal(convertDiscount(999, percent(33.33), 'amount'), 332.97)
    assert.equal(convertDiscount(1000, amount(999.99), 'percent'), 99.99)
  })

  it('switching converts the value instead of clearing it, and the selling price stays the same', () => {
    const toPercent = switchDiscountMode('1000', '150', 'amount', 'percent', null)
    assert.equal(toPercent.text, '15')
    assert.equal(pricesFromForm('1000', 'percent', toPercent.text).prices?.sale, 850)
    const toAmount = switchDiscountMode('1000', '15', 'percent', 'amount', null)
    assert.equal(toAmount.text, '150')
  })

  it('switching straight back restores exactly what was typed, even where converting rounds', () => {
    const there = switchDiscountMode('999', '333', 'amount', 'percent', null)
    assert.equal(there.text, '33.33')
    // 33.33% of 999 is 332.97, not 333: the memo brings back the 333 the owner typed.
    assert.equal(convertDiscount(999, percent(33.33), 'amount'), 332.97)
    const back = switchDiscountMode('999', there.text, 'percent', 'amount', there.memo)
    assert.deepEqual(back, { text: '333', memo: null })
  })

  it('after an edit, switching back converts the new value instead', () => {
    const there = switchDiscountMode('1000', '150', 'amount', 'percent', null)
    // The owner changes 15% to 20% before switching back; the old 150 is no longer what they mean.
    const back = switchDiscountMode('1000', '20', 'percent', 'amount', there.memo)
    assert.equal(back.text, '200')
  })

  it('a changed MRP also converts afresh', () => {
    const there = switchDiscountMode('1000', '150', 'amount', 'percent', null)
    const back = switchDiscountMode('2000', there.text, 'percent', 'amount', there.memo)
    assert.equal(back.text, '300')
  })

  it('an empty discount stays empty; with no MRP yet the number is kept', () => {
    assert.deepEqual(switchDiscountMode('1000', '', 'amount', 'percent', null), { text: '', memo: null })
    assert.deepEqual(switchDiscountMode('', '15', 'percent', 'amount', null), { text: '15', memo: null })
  })
})

describe('the badge', () => {
  it('writes a percentage without trailing zeros', () => {
    assert.equal(percentLabel(15), '15')
    assert.equal(percentLabel(12.5), '12.5')
    assert.equal(percentLabel(33.33), '33.33')
  })
})
