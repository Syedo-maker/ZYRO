/**
 * The questions the shopping assistant offers before the shopper has typed anything (B4). Tapping one
 * sends it as an ordinary message, so it goes through the same quota, rate limit and permission checks
 * as anything typed.
 */

// A round budget that means something in each currency. Written as a bare number and the currency code
// ("under 3,000 PKR"), which the server's budget reader (backend/src/lib/budget.ts) applies in the
// shop's own currency.
const BUDGET_SUGGESTION: Record<string, number> = { PKR: 3000, INR: 2000, LKR: 5000, NPR: 3000, BDT: 3000 }

export function suggestionsFor(currency: string): string[] {
  const code = currency.toUpperCase()
  const amount = BUDGET_SUGGESTION[code] ?? 50
  return ['What are your best sellers?', 'Help me pick a gift', `Something under ${amount.toLocaleString('en-US')} ${code}`, "What's on sale right now?"]
}
