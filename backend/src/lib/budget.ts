/**
 * A shopper's budget, read from what they typed ("something under Rs 3,000", "3k tak", "below $50"),
 * and the one filter that applies it. The shopping assistant uses both for the products it describes
 * in its answer and for the product cards it shows, so the two can never disagree: the AI is only told
 * about products within the budget, and only those are returned as cards.
 *
 * Amounts are compared with a product's selling price (what the customer pays), in the store's own
 * currency; there is no conversion. A budget written in a different currency from the store's (dollars
 * in a rupee shop) cannot be applied honestly, so it is ignored rather than guessed at.
 */

export interface Budget {
  /** The most the shopper wants to pay, in the store's currency. */
  max: number;
}

// Which store currencies each written marker can mean. "Rs" is the rupee of whichever rupee country the
// shop is in; "$" is any dollar.
const MARKERS: [RegExp, string[]][] = [
  [/^(rs\.?|rupees?|₨)$/, ["PKR", "INR", "LKR", "NPR"]],
  [/^(pkr)$/, ["PKR"]],
  [/^(inr|₹)$/, ["INR"]],
  [/^(lkr)$/, ["LKR"]],
  [/^(npr)$/, ["NPR"]],
  [/^(tk|taka|bdt|৳)$/, ["BDT"]],
  [/^(aed|dirhams?|dhs?)$/, ["AED"]],
  [/^(sar|riyals?)$/, ["SAR"]],
  [/^(\$|dollars?)$/, ["USD", "CAD", "AUD"]],
  [/^(usd)$/, ["USD"]],
  [/^(cad)$/, ["CAD"]],
  [/^(aud)$/, ["AUD"]],
  [/^(£|gbp|pounds?)$/, ["GBP"]],
  [/^(€|eur|euros?)$/, ["EUR"]],
];

const CURRENCY = String.raw`(rs\.?|rupees?|₨|pkr|inr|₹|lkr|npr|tk|taka|bdt|৳|aed|dirhams?|dhs?|sar|riyals?|\$|dollars?|usd|cad|aud|£|gbp|pounds?|€|eur|euros?)`;
const AMOUNT = String.raw`(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|hazar|hazaar)?`;
// "under 3000", "below Rs 2,500", "budget of $40", "less than 1.5k", "max 900"
const BEFORE = new RegExp(
  String.raw`(?:under|below|less than|lower than|cheaper than|within|up to|upto|at most|no more than|not more than|maximum|max|budget(?:\s+(?:of|is|around))?|<=?)\s*(?:of\s+)?` +
    String.raw`(?:${CURRENCY}\s*)?${AMOUNT}(?:\s*${CURRENCY})?`,
  "i"
);
// Roman Urdu and "or less": "3000 tak", "Rs 3000 se kam", "2k ke andar", "500 or less"
const AFTER = new RegExp(String.raw`(?:${CURRENCY}\s*)?${AMOUNT}(?:\s*${CURRENCY})?\s*(?:tak|se kam|ke andar|or less|or under|or below|max(?:imum)?)\b`, "i");

function amountOf(digits: string, multiplier: string | undefined): number {
  const n = Number(digits.replace(/,/g, ""));
  return multiplier ? n * 1000 : n;
}

function markerMatches(marker: string | undefined, storeCurrency: string): boolean {
  if (!marker) return true; // a bare number is in the shop's own currency
  const m = marker.toLowerCase().trim();
  const found = MARKERS.find(([re]) => re.test(m));
  return !found || found[1].includes(storeCurrency.toUpperCase());
}

/**
 * The budget in a shopper's message, or null when there is none, it is not a positive amount, or it
 * is written in another currency than the store's.
 */
export function parseBudget(message: string, storeCurrency: string): Budget | null {
  const text = message.toLowerCase();
  const before = BEFORE.exec(text);
  if (before) {
    const [, pre, digits, mult, post] = before;
    if (!markerMatches(pre ?? post, storeCurrency)) return null;
    const max = amountOf(digits, mult);
    return max > 0 ? { max } : null;
  }
  const after = AFTER.exec(text);
  if (after) {
    const [, pre, digits, mult, post] = after;
    if (!markerMatches(pre ?? post, storeCurrency)) return null;
    const max = amountOf(digits, mult);
    return max > 0 ? { max } : null;
  }
  return null;
}

/** The products within the budget (by selling price); every product when there is no budget. */
export function withinBudget<T extends { salePrice: number }>(products: T[], budget: Budget | null): T[] {
  return budget ? products.filter((p) => p.salePrice <= budget.max) : products;
}
