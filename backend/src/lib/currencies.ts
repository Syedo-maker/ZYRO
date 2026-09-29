/**
 * The currencies a store can sell in. Every amount in ZYRO is kept in hundredths (cents, paisa,
 * pence), so only currencies with two decimal places are offered; a zero-decimal currency such as
 * the yen would need different arithmetic everywhere and is deliberately not on the list.
 *
 * `minChargeMinor` is the smallest card payment ZYRO will send to Stripe, in hundredths. The
 * platform's Stripe account settles in US dollars, and Stripe refuses a charge worth less than
 * 0.50 USD after conversion, whatever the currency shown to the shopper. So each floor is a round
 * amount worth roughly 0.60 to 1.00 USD: exchange rates move, and a payment Stripe refuses at the
 * last step is worse for a merchant than a slightly higher floor.
 *
 * The frontend keeps the same list in src/lib/currencies.ts; change both together.
 */
export const STORE_CURRENCIES = [
  { code: "PKR", name: "Pakistani rupee", minChargeMinor: 20000 },
  { code: "INR", name: "Indian rupee", minChargeMinor: 7500 },
  { code: "BDT", name: "Bangladeshi taka", minChargeMinor: 10000 },
  { code: "LKR", name: "Sri Lankan rupee", minChargeMinor: 25000 },
  { code: "NPR", name: "Nepalese rupee", minChargeMinor: 10000 },
  { code: "AED", name: "UAE dirham", minChargeMinor: 300 },
  { code: "SAR", name: "Saudi riyal", minChargeMinor: 300 },
  { code: "USD", name: "US dollar", minChargeMinor: 50 },
  { code: "GBP", name: "British pound", minChargeMinor: 50 },
  { code: "EUR", name: "Euro", minChargeMinor: 75 },
  { code: "CAD", name: "Canadian dollar", minChargeMinor: 100 },
  { code: "AUD", name: "Australian dollar", minChargeMinor: 100 },
] as const;

export type StoreCurrency = (typeof STORE_CURRENCIES)[number]["code"];

export const STORE_CURRENCY_CODES = STORE_CURRENCIES.map((c) => c.code) as [StoreCurrency, ...StoreCurrency[]];

/** The smallest card payment for this currency, in hundredths; an unknown code gets the highest floor on the list. */
export function minChargeMinor(currency: string): number {
  const found = STORE_CURRENCIES.find((c) => c.code === currency.toUpperCase());
  return found ? found.minChargeMinor : Math.max(...STORE_CURRENCIES.map((c) => c.minChargeMinor));
}
