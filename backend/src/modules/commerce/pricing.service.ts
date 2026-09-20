/**
 * Pure order-total calculation shared by every sales channel. No database access, so it
 * is trivially unit-testable and the online cart, the POS cart and the final order
 * creation all compute totals identically.
 *
 * All arithmetic is done in integer cents to avoid floating-point rounding drift; only
 * the final result is converted back to a two-decimal string for Prisma's Decimal columns.
 * Prices are treated as tax-exclusive. Discount validity (expiry, usage limits) is checked
 * elsewhere; this function only applies an already-validated discount.
 */
export interface PricingLine {
  unitPrice: number;
  quantity: number;
  taxable: boolean;
}

export interface PricingDiscount {
  type: "PERCENTAGE" | "FIXED";
  value: number;
}

export interface PricingInput {
  lines: PricingLine[];
  discount?: PricingDiscount | null;
  shippingAmount?: number;
  /** Percentage, e.g. 8.25 for 8.25%. */
  taxRatePercent: number;
}

export interface PricingResult {
  lineTotals: string[];
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  shippingAmount: string;
  total: string;
  totalCents: number;
}

const toCents = (amount: number) => Math.round(amount * 100);
const fromCents = (cents: number) => (cents / 100).toFixed(2);

/**
 * What a discount takes off a subtotal, in cents: a percentage of it, or a fixed amount,
 * never more than the subtotal itself. Shared by the totals below and by discount-code
 * validation, so a code's advertised saving is exactly what checkout applies.
 */
export function discountCentsFor(discount: PricingDiscount, subtotalCents: number): number {
  if (subtotalCents <= 0) return 0;
  const raw =
    discount.type === "PERCENTAGE"
      ? Math.round((subtotalCents * Math.round(discount.value * 100)) / 10000)
      : toCents(discount.value);
  return Math.min(Math.max(raw, 0), subtotalCents);
}

export function calculateTotals(input: PricingInput): PricingResult {
  const lineCents = input.lines.map((l) => toCents(l.unitPrice) * l.quantity);
  const subtotal = lineCents.reduce((a, b) => a + b, 0);
  const taxableSubtotal = input.lines.reduce((sum, l, i) => (l.taxable ? sum + lineCents[i] : sum), 0);

  const discount = input.discount ? discountCentsFor(input.discount, subtotal) : 0;

  // The discount reduces the taxable base in proportion to the taxable share of the order.
  const taxableDiscount = subtotal > 0 ? Math.round((discount * taxableSubtotal) / subtotal) : 0;
  const taxableBase = taxableSubtotal - taxableDiscount;
  const tax = Math.round((taxableBase * Math.round(input.taxRatePercent * 100)) / 10000);

  const shipping = toCents(input.shippingAmount ?? 0);
  const total = subtotal - discount + tax + shipping;

  return {
    lineTotals: lineCents.map(fromCents),
    subtotal: fromCents(subtotal),
    discountAmount: fromCents(discount),
    taxAmount: fromCents(tax),
    shippingAmount: fromCents(shipping),
    total: fromCents(total),
    totalCents: total,
  };
}
