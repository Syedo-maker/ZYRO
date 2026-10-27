import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { PriceTag } from '../../components/PriceTag'
import { errorMessage } from '../../lib/ordersApi'
import { productsApi } from '../../lib/productsApi'
import { can } from '../../lib/permissions'
import { storefrontApi } from '../../lib/storefrontApi'
import type { Product, ProductInput } from '../../types/api'
import { ProductForm } from './ProductForm'
import { QuickStock } from './StockStepper'
import { ProductScoutPanel } from './ProductScoutPanel'
import type { ScoutPrefill } from '../../lib/productScoutApi'

type PanelState = { mode: 'closed' } | { mode: 'create'; prefill?: ScoutPrefill } | { mode: 'edit'; product: Product }

export function ProductsPage() {
  const { activeStore } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currency, setCurrency] = useState('USD')
  const [panel, setPanel] = useState<PanelState>({ mode: 'closed' })
  const location = useLocation()
  const navigate = useNavigate()

  const storeId = activeStore?.id

  // "Add to my store" on the dashboard's panel brings its suggestion here, in the navigation state;
  // it opens the form once, and the state is cleared so a reload does not open it again.
  useEffect(() => {
    const prefill = (location.state as { scoutPrefill?: ScoutPrefill } | null)?.scoutPrefill
    if (!prefill) return
    setPanel({ mode: 'create', prefill })
    navigate(location.pathname, { replace: true, state: null })
  }, [location, navigate])

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
  // Staff without the Products permission see the list only: adding, editing (and with it the AI
  // writing tools) and changing stock would each be refused by the server.
  const canEdit = can(activeStore, 'products_write')

  return (
    // Side by side on a wide screen; on a phone or tablet the form stacks above the list, and the
    // Trending products panel sits at the top.
    <div className="flex flex-col-reverse gap-8 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-xl font-bold">Products</h1>
          {canEdit && <Button onClick={() => setPanel({ mode: 'create' })}>+ Add product</Button>}
        </div>

        {!canEdit && (
          <Alert tone="info">
            You can see this store's products. Adding and editing products, changing stock, and the AI writing tools need the
            Products permission, which your account does not have in this store. Ask the store owner if you need them.
          </Alert>
        )}

        {error && <Alert>{error}</Alert>}

        {/* The list scrolls sideways inside its own box on a narrow screen; the page never does. */}
        <div className="relative bg-surface border border-border rounded-2xl overflow-x-auto">
         {/*
           * Laid out with CSS grid rather than a <table>, so the roles below are what tell a screen
           * reader this is tabular data: without them a cell is read as a bare number with no idea
           * which column it belongs to. The roles change nothing visually; the grid still does the
           * layout. Found by the accessibility audit in e2e/a11y-audit.e2e.mjs.
           */}
         <div className="min-w-[680px]" role="table" aria-label="Products">
          <div role="rowgroup">
           <div role="row" className="grid grid-cols-[2fr_1fr_190px_1fr_88px] gap-3 px-5 py-3 text-[11px] font-bold text-text-muted border-b border-border">
            <div role="columnheader">PRODUCT</div>
            <div role="columnheader">PRICE</div>
            <div role="columnheader">STOCK</div>
            <div role="columnheader">CATEGORY</div>
            <div role="columnheader"><span className="sr-only">Actions</span></div>
           </div>
          </div>

          {isLoading && <div className="px-5 py-6 text-sm text-text-secondary">Loading…</div>}

          {!isLoading && products.length === 0 && !error && (
            <div className="px-5 py-10 text-sm text-text-secondary text-center">
              No products yet. Add your first one to get started.
            </div>
          )}

          <div role="rowgroup">
          {products.map((product) => (
            <div
              key={product.id}
              role="row"
              className="grid grid-cols-[2fr_1fr_190px_1fr_88px] gap-3 px-5 py-3 items-center border-b border-border last:border-0 text-sm"
            >
              <div role="cell" className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-bg shrink-0 overflow-hidden">
                  {product.images[0] && <img src={product.images[0]} alt="" className="w-full h-full object-cover" />}
                </div>
                <span className="font-semibold">{product.title}</span>
              </div>
              <div role="cell"><PriceTag product={product} currency={currency} /></div>
              <div role="cell">
                {canEdit ? (
                <QuickStock
                  storeId={activeStore.id}
                  productId={product.id}
                  title={product.title}
                  stock={product.stock}
                  onSaved={(stock) => setProducts((list) => list.map((p) => (p.id === product.id ? { ...p, stock } : p)))}
                />
                ) : (
                  <span className="tabular-nums">{product.stock}</span>
                )}
              </div>
              <div role="cell" className="text-text-secondary">{product.category}</div>
              <div role="cell" className="flex gap-3">
                {canEdit && (
                <>
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
                </>
                )}
              </div>
            </div>
          ))}
          </div>
         </div>
        </div>
      </div>

      {canEdit && panel.mode !== 'closed' && (
        <div className="w-full shrink-0 bg-surface border border-border rounded-2xl p-4 sm:p-6 h-fit lg:w-[360px]">
          <ProductForm
            key={panel.mode === 'edit' ? panel.product.id : `new-${panel.prefill?.id ?? ''}`}
            storeId={activeStore.id}
            currency={currency}
            initial={panel.mode === 'edit' ? panel.product : undefined}
            prefill={panel.mode === 'create' ? panel.prefill : undefined}
            onSubmit={panel.mode === 'edit' ? handleUpdate : handleCreate}
            onCancel={() => setPanel({ mode: 'closed' })}
          />
        </div>
      )}

      {canEdit && <ProductScoutPanel page="products" forceCollapsed={panel.mode !== 'closed'} onAdd={(prefill) => setPanel({ mode: 'create', prefill })} />}
    </div>
  )
}
