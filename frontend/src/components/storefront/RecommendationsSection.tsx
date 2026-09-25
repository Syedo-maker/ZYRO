import { useEffect, useState } from 'react'
import { useStore } from '../../context/StoreContext'
import { Alert } from '../ui/Alert'
import { ProductCard } from './ProductCard'
import { catalogApi } from '../../lib/shopApi'
import { useAddToCart } from '../../lib/useAddToCart'
import type { Product } from '../../types/api'

/**
 * Products similar to `productId` (Phase 6). A recommendation is a bonus, so this never shows a
 * spinner, an error or an empty box: until the answer arrives, and whenever there is none (no
 * similar products, the service is down, the product was removed), the section is simply absent.
 */
export function RecommendationsSection({ productId, heading, headingId }: { productId: string; heading: string; headingId: string }) {
  const store = useStore()
  const { addingId, message, addToCart } = useAddToCart()
  const [products, setProducts] = useState<Product[]>([])

  useEffect(() => {
    let cancelled = false
    setProducts([])
    catalogApi
      .recommendations(store.id, productId, 4)
      .then((r) => !cancelled && setProducts(r.data))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [store.id, productId])

  if (products.length === 0) return null
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="font-display text-xl font-bold">
        {heading}
      </h2>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} storeId={store.id} currency={store.currency} adding={addingId === p.id} onAdd={(x) => void addToCart(x)} />
        ))}
      </ul>
    </section>
  )
}
