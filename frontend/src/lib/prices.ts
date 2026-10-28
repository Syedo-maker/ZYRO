/**
 * The three prices of a product (the supervisor's product-listing change, discount modes 2026-10-23).
 *
 * The owner types the actual price (MRP) and, optionally, a discount: an amount off ("Rs 200 off")
 * or a percentage off ("15% off"). The selling price customers pay is worked out from the two and is
 * never typed: MRP minus the discount.
 *
 * Every store currency keeps amounts in hundredths (lib/currencies.ts), so all of this is done in
 * whole hundredths: amounts are rounded to the hundredth, percentages to two decimal places, and a
 * percentage discount is rounded to the hundredth before it is taken off. The selling price is then
 * exactly MRP minus the discount shown, so the badge, the crossed-out MRP and the price always add up.
 *
 * This is the product form's copy, so the owner sees the selling price as they type; the server
 * (backend/src/lib/prices.ts) does the same arithmetic when the product is saved. Change both together:
 * frontend/tests/prices.test.ts and backend/tests/unit/product-prices.test.ts check the same cases.
 */

export const DISCOUNT_TYPES = ['amount', 'percent'] as const
export type DiscountType = (typeof DISCOUNT_TYPES)[number]

export interface Discount {
  type: DiscountType
  value: number
}

const hundredths = (n: number) => Math.round(n * 100)

/** The discount in hundredths of the currency, for an MRP in hundredths. */
function discountHundredths(mrp: number, discount: Discount | null): number {
  if (!discount) return 0
  if (discount.type === 'amount') return hundredths(discount.value)
  return Math.round((mrp * hundredths(discount.value)) / 10_000)
}

/**
 * What is wrong with these prices, in words for the owner, or null when they are fine: the MRP above
 * zero; the discount not below zero and less than the MRP (or less than 100%); and the selling price
 * left above zero after rounding.
 */
export function priceProblem(mrp: number, discount: Discount | null): string | null {
  if (!Number.isFinite(mrp) || hundredths(mrp) < 1) return 'The price (MRP) must be more than zero'
  if (!discount) return null
  if (!Number.isFinite(discount.value) || discount.value < 0) return 'The discount cannot be below zero'
  if (discount.type === 'percent' && !(discount.value < 100)) return 'A percentage discount must be less than 100%'
  if (discount.type === 'amount' && !(hundredths(discount.value) < hundredths(mrp))) return 'The discount must be less than the price (MRP)'
  if (hundredths(mrp) - discountHundredths(hundredths(mrp), discount) < 1) return 'The selling price must stay above zero'
  return null
}

export interface Prices {
  /** The MRP, rounded to the hundredth. */
  actual: number
  /** The discount as stored: its type and its value rounded (amounts to the hundredth, percentages to 2 places); null for none. */
  discount: Discount | null
  /** The amount taken off the MRP, in money. */
  discountAmount: number
  /** What customers pay: MRP minus the discount. */
  sale: number
}

/** The prices from the owner's MRP and discount. A discount of zero is no discount. Check priceProblem first. */
export function computePrices(mrp: number, discount: Discount | null): Prices {
  const actual = hundredths(mrp)
  const normalised: Discount | null = discount ? { type: discount.type, value: hundredths(discount.value) / 100 } : null
  const off = discountHundredths(actual, normalised)
  return {
    actual: actual / 100,
    discount: off > 0 ? normalised : null,
    discountAmount: off / 100,
    sale: (actual - off) / 100,
  }
}

/**
 * The same discount in the other mode, for the form's Rs / % switch: an amount as the percentage of
 * the MRP it is (to 2 places, kept under 100), or a percentage as the amount it takes off.
 */
export function convertDiscount(mrp: number, discount: Discount, to: DiscountType): number {
  if (discount.type === to) return discount.value
  const actual = hundredths(mrp)
  if (actual < 1) return 0
  if (to === 'amount') return discountHundredths(actual, discount) / 100
  return Math.min(9_999, Math.round((hundredths(discount.value) * 10_000) / actual)) / 100
}

/** The "% off" or "Rs off" wording's number for a percentage: 15, 12.5, 33.33 (no trailing zeros). */
export const percentLabel = (value: number) => String(hundredths(value) / 100)

// ---------------------------------------------------------------------------------------------
// The product form: prices from what the owner has typed, and the Rs / % switch
// ---------------------------------------------------------------------------------------------

/**
 * The prices from the form's three boxes as typed: the selling price to show, or why it cannot be
 * shown. Nothing while the MRP is empty; an empty discount box is no discount.
 */
export function pricesFromForm(mrpText: string, type: DiscountType, valueText: string): { prices: Prices | null; problem: string | null } {
  if (mrpText.trim() === '') return { prices: null, problem: null }
  const mrp = Number(mrpText)
  const discount: Discount | null = valueText.trim() === '' ? null : { type, value: Number(valueText) }
  const problem = priceProblem(mrp, discount)
  return problem ? { prices: null, problem } : { prices: computePrices(mrp, discount), problem: null }
}

/** What the form remembers at a switch, so switching straight back returns exactly what was typed. */
export interface DiscountSwitchMemo {
  type: DiscountType
  text: string
  mrpText: string
  /** The converted value the switch put in the box. */
  convertedText: string
}

/**
 * Switches the discount box between Rs and %: the value is converted, not cleared (Rs 150 off a
 * 1,000 MRP becomes 15%). Converting can round (Rs 333 off 999 is 33.33%), so the form keeps what was
 * typed: switching straight back, with nothing edited in between, restores it exactly. With no
 * usable MRP there is nothing to convert against, and the number is kept as typed.
 */
export function switchDiscountMode(
  mrpText: string,
  valueText: string,
  from: DiscountType,
  to: DiscountType,
  memo: DiscountSwitchMemo | null,
): { text: string; memo: DiscountSwitchMemo | null } {
  if (from === to) return { text: valueText, memo }
  if (memo && memo.type === to && memo.mrpText === mrpText && memo.convertedText === valueText) return { text: memo.text, memo: null }
  const mrp = Number(mrpText)
  const value = Number(valueText)
  if (valueText.trim() === '' || !Number.isFinite(value) || mrpText.trim() === '' || !(hundredths(mrp) >= 1)) return { text: valueText, memo: null }
  const text = String(convertDiscount(mrp, { type: from, value }, to))
  return { text, memo: { type: from, text: valueText, mrpText, convertedText: text } }
}
