import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'
import { StarRating } from '../StarRating'
import { PriceTag } from '../PriceTag'
import type { Product } from '../../types/api'

/**
 * A product in a grid: the picture, name, rating and price open the product page; "Add to cart"
 * is its own button next to the link (never nested inside it) so both work from the keyboard.
 */
export function ProductCard({
  product,
  storeId,
  currency,
  adding,
  onAdd,
}: {
  product: Product
  storeId: string
  currency: string
  adding: boolean
  onAdd: (product: Product) => void
}) {
  const soldOut = product.stock < 1
  return (
    <li className="group/card flex flex-col overflow-hidden rounded-2xl border border-border bg-surface transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-text/20 hover:shadow-md">
      <Link to={`/store/${storeId}/products/${product.id}`} className="group flex flex-1 flex-col gap-2 p-3 outline-offset-[-2px]">
        <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-subtle">
          {product.images[0] ? (
            <img src={product.images[0]} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 ease-standard group-hover:scale-[1.04]" />
          ) : (
            <span aria-hidden="true" className="flex h-full items-center justify-center font-display text-3xl font-bold text-border">
              {product.title.slice(0, 1).toUpperCase()}
            </span>
          )}
          {soldOut && (
            <span className="absolute left-2 top-2 rounded-full bg-bg/85 px-2.5 py-1 text-[11px] font-bold text-text backdrop-blur">Sold out</span>
          )}
        </div>
        <h3 className="text-sm font-semibold leading-snug group-hover:text-brand-ink">{product.title}</h3>
        <StarRating value={product.averageRating} count={product.reviewCount} size="sm" />
        <PriceTag product={product} currency={currency} />
      </Link>
      <div className="px-3 pb-3">
        <Button variant="secondary" className="h-10 w-full" disabled={soldOut || adding} onClick={() => onAdd(product)}>
          {soldOut ? 'Sold out' : adding ? 'Adding...' : 'Add to cart'}
        </Button>
      </div>
    </li>
  )
}
