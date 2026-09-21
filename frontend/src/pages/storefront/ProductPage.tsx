import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useStore } from '../../context/StoreContext'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { StarRating } from '../../components/StarRating'
import { ReviewsSection } from '../../components/storefront/ReviewsSection'
import { formatMoney } from '../../lib/format'
import { ApiError } from '../../lib/apiClient'
import { errorMessage } from '../../lib/ordersApi'
import { catalogApi } from '../../lib/shopApi'
import { useAddToCart } from '../../lib/useAddToCart'
import type { Product } from '../../types/api'

function stockNote(stock: number): { text: string; tone: string } {
  if (stock < 1) return { text: 'Sold out', tone: 'text-danger' }
  if (stock <= 5) return { text: `Only ${stock} left in stock`, tone: 'text-warning' }
  return { text: 'In stock', tone: 'text-success' }
}

export function ProductPage() {
  const store = useStore()
  const { productId = '' } = useParams()
  const { addingId, message, addToCart } = useAddToCart()
  const [product, setProduct] = useState<Product | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [image, setImage] = useState(0)
  const [quantity, setQuantity] = useState(1)

  const load = useCallback(async () => {
    try {
      setProduct(await catalogApi.get(store.id, productId))
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true)
      else setError(errorMessage(e))
    }
  }, [store.id, productId])

  useEffect(() => {
    setProduct(null)
    setNotFound(false)
    setError(null)
    setImage(0)
    setQuantity(1)
    void load()
  }, [load])

  if (notFound) {
    return (
      <div className="rounded-2xl border border-border bg-white px-6 py-16 text-center">
        <h1 className="font-display text-xl font-bold">Product not found</h1>
        <p className="mt-2 text-sm text-text-secondary">It may have been removed.</p>
        <Link to={`/store/${store.id}/products`} className="mt-4 inline-block text-sm font-semibold text-brand">
          Browse all products
        </Link>
      </div>
    )
  }
  if (error) return <Alert>{error}</Alert>
  if (!product) return <Spinner label="Loading product" />

  const note = stockNote(product.stock)
  const maxQty = Math.max(1, product.stock)

  return (
    <div className="flex flex-col gap-10">
      <nav aria-label="Breadcrumb" className="text-xs text-text-secondary">
        <Link to={`/store/${store.id}`} className="hover:text-text">
          Home
        </Link>
        <span aria-hidden="true"> / </span>
        <Link to={`/store/${store.id}/products?category=${encodeURIComponent(product.category)}`} className="hover:text-text">
          {product.category}
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{product.title}</span>
      </nav>

      <div className="grid gap-8 md:grid-cols-2 md:gap-12">
        <div className="flex flex-col gap-3">
          <div className="aspect-square overflow-hidden rounded-2xl border border-border bg-white">
            {product.images[image] ? (
              <img src={product.images[image]} alt={product.title} className="h-full w-full object-cover" />
            ) : (
              <span aria-hidden="true" className="flex h-full items-center justify-center font-display text-7xl font-bold text-border">
                {product.title.slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>
          {product.images.length > 1 && (
            <ul className="flex flex-wrap gap-2" aria-label="Product pictures">
              {product.images.map((src, i) => (
                <li key={src}>
                  <button
                    onClick={() => setImage(i)}
                    aria-label={`Show picture ${i + 1} of ${product.images.length}`}
                    aria-current={i === image}
                    className={`h-16 w-16 overflow-hidden rounded-lg border-2 ${i === image ? 'border-brand' : 'border-border'}`}
                  >
                    <img src={src} alt="" className="h-full w-full object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <h1 className="font-display text-3xl font-bold">{product.title}</h1>
          <a href="#reviews" className="flex w-fit items-center gap-2 text-sm text-text-secondary hover:text-text">
            <StarRating value={product.averageRating} />
            <span>
              {product.averageRating != null ? `${product.averageRating.toFixed(1)} · ` : ''}
              {product.reviewCount ?? 0} {product.reviewCount === 1 ? 'review' : 'reviews'}
            </span>
          </a>
          <p className="font-display text-3xl font-bold">{formatMoney(product.price, store.currency)}</p>
          <p className={`text-sm font-semibold ${note.tone}`}>{note.text}</p>
          {product.description && <p className="whitespace-pre-line text-sm leading-relaxed text-text-secondary">{product.description}</p>}

          {message && <Alert tone={message.tone}>{message.text}</Alert>}

          <div className="flex flex-wrap items-center gap-3">
            <div role="group" aria-label="Quantity" className="flex items-center">
              <button
                aria-label="Decrease quantity"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1 || product.stock < 1}
                className="h-11 w-11 rounded-l-[10px] border border-border text-lg font-semibold hover:bg-bg disabled:opacity-50"
              >
                -
              </button>
              <output aria-live="polite" className="flex h-11 w-14 items-center justify-center border-y border-border text-sm font-semibold">
                {product.stock < 1 ? 0 : quantity}
              </output>
              <button
                aria-label="Increase quantity"
                onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
                disabled={quantity >= maxQty || product.stock < 1}
                className="h-11 w-11 rounded-r-[10px] border border-border text-lg font-semibold hover:bg-bg disabled:opacity-50"
              >
                +
              </button>
            </div>
            <Button className="h-11 flex-1 sm:flex-none sm:px-8" disabled={product.stock < 1 || addingId === product.id} onClick={() => void addToCart(product, quantity)}>
              {product.stock < 1 ? 'Sold out' : addingId === product.id ? 'Adding...' : 'Add to cart'}
            </Button>
          </div>
        </div>
      </div>

      <ReviewsSection productId={product.id} onChanged={() => void catalogApi.get(store.id, productId).then(setProduct).catch(() => undefined)} />
    </div>
  )
}
