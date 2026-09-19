import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { formatMoney } from '../../lib/format'
import { errorMessage } from '../../lib/ordersApi'
import { productsApi } from '../../lib/productsApi'
import { storefrontApi } from '../../lib/storefrontApi'
import type { Product, ProductInput } from '../../types/api'
import { ProductForm } from './ProductForm'

type PanelState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; product: Product }

export function ProductsPage() {
  const { activeStore } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currency, setCurrency] = useState('USD')
  const [panel, setPanel] = useState<PanelState>({ mode: 'closed' })

  const storeId = activeStore?.id

  const reload = useCallback(async () => {
    if (!storeId) return
    try {
      const result = await productsApi.list(storeId)
      setProducts(result.data)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, 'Could not load your products.'))
    } finally {
      setIsLoading(false)
    }
  }, [storeId])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (!storeId) return
    storefrontApi.getStore(storeId).then((s) => setCurrency(s.currency)).catch(() => undefined)
  }, [storeId])

  async function handleCreate(input: ProductInput) {
    if (!storeId) return
    await productsApi.create(storeId, input)
    setPanel({ mode: 'closed' })
    await reload()
  }

  async function handleUpdate(input: ProductInput) {
    if (!storeId || panel.mode !== 'edit') return
    await productsApi.update(storeId, panel.product.id, input)
    setPanel({ mode: 'closed' })
    await reload()
  }

  async function handleDelete(product: Product) {
    if (!storeId) return
    if (!confirm(`Delete "${product.title}"? This can't be undone.`)) return
    try {
      await productsApi.remove(storeId, product.id)
      await reload()
    } catch (e) {
      setError(errorMessage(e, `Could not delete "${product.title}".`))
    }
  }

  if (!activeStore) {
    return <p className="text-text-secondary">No store found for this account yet.</p>
  }

  return (
    <div className="flex gap-8">
      <div className="flex-1 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-xl font-bold">Products</h1>
          <Button onClick={() => setPanel({ mode: 'create' })}>+ Add product</Button>
        </div>

        {error && <Alert>{error}</Alert>}

        <div className="bg-white border border-border rounded-2xl overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_88px] gap-3 px-5 py-3 text-[11px] font-bold text-text-muted border-b border-border">
            <div>PRODUCT</div>
            <div>PRICE</div>
            <div>STOCK</div>
            <div>CATEGORY</div>
            <div />
          </div>

          {isLoading && <div className="px-5 py-6 text-sm text-text-secondary">Loading…</div>}

          {!isLoading && products.length === 0 && !error && (
            <div className="px-5 py-10 text-sm text-text-secondary text-center">
              No products yet. Add your first one to get started.
            </div>
          )}

          {products.map((product) => (
            <div
              key={product.id}
              className="grid grid-cols-[2fr_1fr_1fr_1fr_88px] gap-3 px-5 py-3 items-center border-b border-border last:border-0 text-sm"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-bg shrink-0 overflow-hidden">
                  {product.images[0] && <img src={product.images[0]} alt="" className="w-full h-full object-cover" />}
                </div>
                <span className="font-semibold">{product.title}</span>
              </div>
              <div>{formatMoney(product.price, currency)}</div>
              <div>{product.stock}</div>
              <div className="text-text-secondary">{product.category}</div>
              <div className="flex gap-3">
                <button
                  onClick={() => setPanel({ mode: 'edit', product })}
                  aria-label={`Edit ${product.title}`}
                  className="text-brand font-semibold text-xs"
                >
                  Edit
                </button>
                <button
                  onClick={() => void handleDelete(product)}
                  aria-label={`Delete ${product.title}`}
                  className="text-danger font-semibold text-xs"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {panel.mode !== 'closed' && (
        <div className="w-[360px] shrink-0 bg-white border border-border rounded-2xl p-6 h-fit">
          <ProductForm
            key={panel.mode === 'edit' ? panel.product.id : 'new'}
            storeId={activeStore.id}
            initial={panel.mode === 'edit' ? panel.product : undefined}
            onSubmit={panel.mode === 'edit' ? handleUpdate : handleCreate}
            onCancel={() => setPanel({ mode: 'closed' })}
          />
        </div>
      )}
    </div>
  )
}
