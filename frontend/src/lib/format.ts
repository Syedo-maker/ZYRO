import { homeLocale } from './currencies'

/**
 * A price as the shopper reads it. Intl shows some currencies (the Pakistani rupee) without decimals
 * by convention, but amounts are kept to the hundredth, so a price that has any is always shown with
 * both digits: Rs 450, but Rs 99.50, never a rounded Rs 100 that would not add up on a receipt.
 */
export function formatMoney(amount: number, currency: string): string {
  const cents = Number.isInteger(Math.round(amount * 100) / 100) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 }
  try {
    return new Intl.NumberFormat(homeLocale(currency), { style: 'currency', currency, ...cents }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
