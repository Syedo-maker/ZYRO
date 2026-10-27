import { formatMoney } from '../lib/format'
import type { Product } from '../types/api'

const SIZES = {
  sm: { sale: 'text-sm font-bold', actual: 'text-xs', badge: 'px-2 py-0.5 text-[10px]' },
  lg: { sale: 'font-display text-3xl font-bold', actual: 'text-base', badge: 'px-2.5 py-1 text-xs' },
} as const

/**
 * A product's price as shoppers see it: what they pay, prominent; when it is discounted, the MRP
 * struck through after it and a "% off" badge. Screen readers hear "was" and "now" rather than a
 * strike they cannot see. Used on the product card, the product page and the admin product list.
 */
export function PriceTag({
  product,
  currency,
  size = 'sm',
}: {
  product: Pick<Product, 'salePrice' | 'actualPrice' | 'discountPercent'>
  currency: string
  size?: keyof typeof SIZES
}) {
  const s = SIZES[size]
  const discounted = product.discountPercent !== null && product.salePrice < product.actualPrice
  if (!discounted) return <p className={s.sale}>{formatMoney(product.salePrice, currency)}</p>
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className={s.sale}>
        <span className="sr-only">Now </span>
        {formatMoney(product.salePrice, currency)}
      </span>
      <s className={`${s.actual} text-text-muted`}>
        <span className="sr-only">was </span>
        {formatMoney(product.actualPrice, currency)}
      </s>
      <span className={`self-center rounded-full bg-success-soft font-bold text-success ${s.badge}`}>{product.discountPercent}% off</span>
    </p>
  )
}
