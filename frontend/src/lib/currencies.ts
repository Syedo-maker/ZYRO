/**
 * The currencies a store can sell in, for the sign-up form. The same list lives in
 * backend/src/lib/currencies.ts, which is what the server accepts; change both together.
 * (The Settings page reads the list from the server instead.)
 */
export const STORE_CURRENCIES = [
  { code: 'PKR', name: 'Pakistani rupee', locale: 'en-PK' },
  { code: 'INR', name: 'Indian rupee', locale: 'en-IN' },
  { code: 'BDT', name: 'Bangladeshi taka', locale: 'en-BD' },
  { code: 'LKR', name: 'Sri Lankan rupee', locale: 'en-LK' },
  { code: 'NPR', name: 'Nepalese rupee', locale: 'en-NP' },
  { code: 'AED', name: 'UAE dirham', locale: 'en-AE' },
  { code: 'SAR', name: 'Saudi riyal', locale: 'en-SA' },
  { code: 'USD', name: 'US dollar', locale: 'en-US' },
  { code: 'GBP', name: 'British pound', locale: 'en-GB' },
  { code: 'EUR', name: 'Euro', locale: 'en-IE' },
  { code: 'CAD', name: 'Canadian dollar', locale: 'en-CA' },
  { code: 'AUD', name: 'Australian dollar', locale: 'en-AU' },
] as const

/**
 * How prices in this currency are written where it is used (Rs 450, ₹1,23,456, £12.00). A price
 * belongs to the store, so it reads the same to everyone, whatever language their browser is set to;
 * an unknown code falls back to the viewer's own settings.
 */
export function homeLocale(currency: string): string | undefined {
  return STORE_CURRENCIES.find((c) => c.code === currency.toUpperCase())?.locale
}

/** ZYRO is built for Pakistani shops first, so sign-up starts on the rupee. */
export const DEFAULT_STORE_CURRENCY = 'PKR'
