import { useEffect, useState } from 'react'
import { useCart } from '../../context/CartContext'
import { useStore } from '../../context/StoreContext'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { formatMoney } from '../../lib/format'
import { errorMessage } from '../../lib/ordersApi'
import { productsApi } from '../../lib/productsApi'
import type { Product } from '../../types/api'

/**
 * A deliberately minimal product grid so shoppers can reach the cart. It is replaced in
 * Phase 3 by the real storefront home, category and product pages (Main, CategoryListing,
 * ProductDetail wireframes).
 */
export function StorefrontHome() {
  const store = useStore()
  const { add } = useCart()
  const [products, setProducts] = useState<Product[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    productsApi
      .list(store.id)
      .then((r) => !cancelled && setProducts(r.data))
      .catch((e) => !cancelled && setLoadError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [store.id])

  async function handleAdd(product: Product) {
    setAddingId(product.id)
    setMessage(null)
    try {
      await add(product.id, 1)
      setMessage({ tone: 'success', text: `${product.title} added to your cart.` })
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) })
    } finally {
      setAddingId(null)
    }
  }

  if (loadError) return <Alert>{loadError}</Alert>

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold">Shop</h1>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      {products === null && <p className="text-sm text-text-secondary">Loading products…</p>}
      {products?.length === 0 && (
        <p className="rounded-2xl border border-border bg-white px-6 py-12 text-center text-sm text-text-secondary">
          This store has no products yet.
        </p>
      )}

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products?.map((p) => (
          <li key={p.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-4">
            <div className="aspect-[4/3] overflow-hidden rounded-[10px] bg-bg">
              {p.images[0] && <img src={p.images[0]} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-semibold">{p.title}</h2>
              <p className="mt-1 text-sm font-bold">{formatMoney(p.price, store.currency)}</p>
            </div>
            <Button onClick={() => void handleAdd(p)} disabled={p.stock < 1 || addingId === p.id}>
              {p.stock < 1 ? 'Sold out' : addingId === p.id ? 'Adding…' : 'Add to cart'}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
