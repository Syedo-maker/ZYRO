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
 * The product form does the same arithmetic as the owner types (frontend/src/lib/prices.ts); change
 * both together. Both have tests with the same cases.
 */

export const DISCOUNT_TYPES = ["amount", "percent"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export interface Discount {
  type: DiscountType;
  value: number;
}

const hundredths = (n: number) => Math.round(n * 100);

/** The discount in hundredths of the currency, for an MRP in hundredths. */
function discountHundredths(mrp: number, discount: Discount | null): number {
  if (!discount) return 0;
  if (discount.type === "amount") return hundredths(discount.value);
  return Math.round((mrp * hundredths(discount.value)) / 10_000);
}

/**
 * What is wrong with these prices, in words for the owner, or null when they are fine: the MRP above
 * zero; the discount not below zero and less than the MRP (or less than 100%); and the selling price
 * left above zero after rounding.
 */
export function priceProblem(mrp: number, discount: Discount | null): string | null {
  if (!Number.isFinite(mrp) || hundredths(mrp) < 1) return "The price (MRP) must be more than zero";
  if (!discount) return null;
  if (!Number.isFinite(discount.value) || discount.value < 0) return "The discount cannot be below zero";
  if (discount.type === "percent" && !(discount.value < 100)) return "A percentage discount must be less than 100%";
  if (discount.type === "amount" && !(hundredths(discount.value) < hundredths(mrp))) return "The discount must be less than the price (MRP)";
  if (hundredths(mrp) - discountHundredths(hundredths(mrp), discount) < 1) return "The selling price must stay above zero";
  return null;
}

export interface Prices {
  /** The MRP, rounded to the hundredth. */
  actual: number;
  /** The discount as stored: its type and its value rounded (amounts to the hundredth, percentages to 2 places); null for none. */
  discount: Discount | null;
  /** The amount taken off the MRP, in money. */
  discountAmount: number;
  /** What customers pay: MRP minus the discount. */
  sale: number;
}

/** The prices from the owner's MRP and discount. A discount of zero is no discount. Check priceProblem first. */
export function computePrices(mrp: number, discount: Discount | null): Prices {
  const actual = hundredths(mrp);
  const normalised: Discount | null = discount ? { type: discount.type, value: hundredths(discount.value) / 100 } : null;
  const off = discountHundredths(actual, normalised);
  return {
    actual: actual / 100,
    discount: off > 0 ? normalised : null,
    discountAmount: off / 100,
    sale: (actual - off) / 100,
  };
}

/**
 * The same discount in the other mode, for the form's Rs / % switch: an amount as the percentage of
 * the MRP it is (to 2 places, kept under 100), or a percentage as the amount it takes off.
 */
export function convertDiscount(mrp: number, discount: Discount, to: DiscountType): number {
  if (discount.type === to) return discount.value;
  const actual = hundredths(mrp);
  if (actual < 1) return 0;
  if (to === "amount") return discountHundredths(actual, discount) / 100;
  return Math.min(9_999, Math.round((hundredths(discount.value) * 10_000) / actual)) / 100;
}

/** The "% off" or "Rs off" wording's number for a percentage: 15, 12.5, 33.33 (no trailing zeros). */
export const percentLabel = (value: number) => String(hundredths(value) / 100);
