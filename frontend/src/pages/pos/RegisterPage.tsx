import { useCallback, useEffect, useRef, useState } from 'react'
import { usePos } from '../../context/PosContext'
import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { errorMessage } from '../../lib/ordersApi'
import { formatMoney } from '../../lib/format'
import { posApi } from '../../lib/posApi'
import type { PosProduct, Sale } from '../../types/pos'
import { CustomerDialog } from './CustomerDialog'
import { DiscountDialog } from './DiscountDialog'
import { HeldSalesDialog } from './HeldSalesDialog'
import { PaymentDialog } from './PaymentDialog'
import { SaleCompleteDialog } from './SaleCompleteDialog'
import { OpenShiftCard } from './ShiftPanels'

type Dialogs = 'none' | 'discount' | 'customer' | 'held' | 'payment'

export function RegisterPage() {
  const { shift } = usePos()
  if (!shift) return <OpenShiftCard />
  return <Register />
}

function Register() {
  const { storeId, session, cart, quote, quoteError, quoting, discount, customer } = usePos()
  const { addProduct, setQuantity, removeLine, setDiscount, setCustomer, clearCart } = usePos()
  const money = (n: number) => formatMoney(n, session.store.currency)

  const [dialog, setDialog] = useState<Dialogs>('none')
  const [completed, setCompleted] = useState<Sale | null>(null)
  const [heldCount, setHeldCount] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  // Bumped after each sale so the product grid reloads with the new stock levels.
  const [gridVersion, setGridVersion] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  const refocus = useCallback(() => setTimeout(() => searchRef.current?.focus(), 0), [])
  const refreshHeld = useCallback(() => {
    posApi.listHeld(storeId).then((h) => setHeldCount(h.length)).catch(() => undefined)
  }, [storeId])
  useEffect(refreshHeld, [refreshHeld])

  // A status line such as "Sale held" only matters for a moment; leaving it up looks stale.
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  const itemCount = cart.reduce((n, l) => n + l.quantity, 0)
  const canCharge = cart.length > 0 && !!quote && !quoting && quote.shortages.length === 0 && quote.total > 0

  function closeDialog() {
    setDialog('none')
    refocus()
  }

  return (
    <div className="grid lg:grid-cols-[1fr_400px] gap-0 lg:h-[calc(100vh-57px)]">
      <ProductPane
        key={gridVersion}
        searchRef={searchRef}
        notice={notice}
        onAdd={(p) => {
          addProduct(p)
          setNotice(`Added ${p.title}`)
        }}
        onNotice={setNotice}
      />

      <aside aria-label="Current sale" className="bg-white border-l border-border flex flex-col lg:min-h-0">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-display text-base font-bold">
            Current sale {itemCount > 0 && <span className="text-text-secondary font-medium">({itemCount} items)</span>}
          </h2>
          <div className="flex gap-3 text-sm font-semibold">
            <button onClick={() => setDialog('held')} className="text-brand hover:text-brand-hover">
              Held{heldCount > 0 ? ` (${heldCount})` : ''}
            </button>
            {cart.length > 0 && (
              <button
                onClick={() => {
                  clearCart()
                  refocus()
                }}
                className="text-danger"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 min-h-[160px]">
          {cart.length === 0 ? (
            <p className="text-sm text-text-secondary py-8 text-center">Scan a barcode or tap a product to start a sale.</p>
          ) : (
            <ul className="divide-y divide-border">
              {cart.map((line) => {
                const priced = quote?.lines.find((l) => l.productId === line.productId)
                const unit = priced?.unitPrice ?? line.unitPrice
                const short = quote?.shortages.find((s) => s.productId === line.productId)
                return (
                  <li key={line.productId} className="py-3 flex flex-col gap-2">
                    <div className="flex justify-between gap-3">
                      <span className="text-sm font-semibold">{line.title}</span>
                      <span className="text-sm font-semibold tabular-nums">{priced ? money(priced.lineTotal) : unit !== null ? money(unit * line.quantity) : '...'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1" role="group" aria-label={`Quantity of ${line.title}`}>
                        <button
                          aria-label={`Decrease ${line.title}`}
                          onClick={() => setQuantity(line.productId, line.quantity - 1)}
                          className="h-10 w-10 rounded-[10px] border border-border text-lg font-semibold hover:bg-bg"
                        >
                          -
                        </button>
                        <span className="w-10 text-center text-sm font-semibold tabular-nums" aria-live="polite">
                          {line.quantity}
                        </span>
                        <button
                          aria-label={`Increase ${line.title}`}
                          onClick={() => setQuantity(line.productId, line.quantity + 1)}
                          className="h-10 w-10 rounded-[10px] border border-border text-lg font-semibold hover:bg-bg"
                        >
                          +
                        </button>
                      </div>
                      <span className="text-xs text-text-secondary">{unit !== null ? `${money(unit)} each` : ''}</span>
                      <button onClick={() => removeLine(line.productId)} className="text-xs font-semibold text-danger" aria-label={`Remove ${line.title}`}>
                        Remove
                      </button>
                    </div>
                    {short && <Badge tone="danger">{`Only ${short.available} in stock`}</Badge>}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border px-5 py-4 flex flex-col gap-3">
          <div className="flex gap-2 text-sm">
            <button
              onClick={() => setDialog('customer')}
              className="flex-1 rounded-[10px] border border-border px-3 py-2.5 text-left hover:bg-bg"
            >
              <span className="block text-xs text-text-secondary">Customer</span>
              <span className="font-semibold">{customer ? (customer.name ?? customer.email ?? customer.phone ?? 'Customer') : 'Walk-in'}</span>
            </button>
            <button
              onClick={() => setDialog('discount')}
              disabled={cart.length === 0}
              className="flex-1 rounded-[10px] border border-border px-3 py-2.5 text-left hover:bg-bg disabled:opacity-50"
            >
              <span className="block text-xs text-text-secondary">Discount</span>
              <span className="font-semibold">
                {discount ? (discount.type === 'percentage' ? `${discount.value}%` : money(discount.value)) : 'None'}
              </span>
            </button>
          </div>
          {customer && (
            <button onClick={() => setCustomer(null)} className="self-start text-xs font-semibold text-brand">
              Remove customer
            </button>
          )}

          {quoteError && <Alert>{quoteError}</Alert>}
          {discount && quoteError && (
            <button onClick={() => setDiscount(null)} className="self-start text-xs font-semibold text-brand">
              Remove discount
            </button>
          )}

          <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm" aria-live="polite">
            <dt className="text-text-secondary">Subtotal</dt>
            <dd className="text-right tabular-nums">{quote ? money(quote.subtotal) : '-'}</dd>
            {quote && quote.discountAmount > 0 && (
              <>
                <dt className="text-text-secondary">Discount ({quote.discountPercent}%)</dt>
                <dd className="text-right tabular-nums">-{money(quote.discountAmount)}</dd>
              </>
            )}
            <dt className="text-text-secondary">Tax</dt>
            <dd className="text-right tabular-nums">{quote ? money(quote.taxAmount) : '-'}</dd>
            <dt className="font-display text-lg font-bold pt-1">Total</dt>
            <dd className="text-right font-display text-lg font-bold pt-1 tabular-nums">{quote ? money(quote.total) : '-'}</dd>
          </dl>

          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="h-14"
              disabled={cart.length === 0}
              onClick={async () => {
                try {
                  await posApi.holdSale(storeId, {
                    items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity })),
                    discount,
                    customerId: customer?.id,
                    label: customer?.name ?? undefined,
                  })
                  clearCart()
                  refreshHeld()
                  setNotice('Sale held. Resume it from Held.')
                  refocus()
                } catch (err) {
                  setNotice(errorMessage(err))
                }
              }}
            >
              Hold
            </Button>
            <Button className="h-14 flex-1 text-base" disabled={!canCharge} onClick={() => setDialog('payment')}>
              {quoting ? 'Pricing...' : `Charge ${quote ? money(quote.total) : ''}`}
            </Button>
          </div>
        </div>
      </aside>

      {dialog === 'discount' && <DiscountDialog onClose={closeDialog} />}
      {dialog === 'customer' && <CustomerDialog onClose={closeDialog} />}
      {dialog === 'held' && <HeldSalesDialog onClose={closeDialog} onChanged={refreshHeld} />}
      {dialog === 'payment' && quote && (
        <PaymentDialog
          quote={quote}
          onClose={closeDialog}
          onCompleted={(sale) => {
            setDialog('none')
            setCompleted(sale)
            setNotice(null)
            setGridVersion((v) => v + 1)
            clearCart()
          }}
        />
      )}
      {completed && (
        <SaleCompleteDialog
          sale={completed}
          onClose={() => {
            setCompleted(null)
            refocus()
          }}
        />
      )}
    </div>
  )
}

function ProductPane({
  searchRef,
  notice,
  onAdd,
  onNotice,
}: {
  searchRef: React.RefObject<HTMLInputElement | null>
  notice: string | null
  onAdd: (p: PosProduct) => void
  onNotice: (message: string | null) => void
}) {
  const { storeId, session } = usePos()
  const money = (n: number) => formatMoney(n, session.store.currency)
  const [text, setText] = useState('')
  const [products, setProducts] = useState<PosProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Typing searches by name; results for older keystrokes are dropped.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(
      () => {
        posApi
          .searchProducts(storeId, { q: text.trim() || undefined })
          .then((p) => {
            if (cancelled) return
            setProducts(p)
            setError(null)
          })
          .catch((err: unknown) => {
            if (!cancelled) setError(errorMessage(err, 'Could not load products.'))
          })
          .finally(() => {
            if (!cancelled) setLoading(false)
          })
      },
      text ? 250 : 0
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [storeId, text])

  // A scanner types the code and presses Enter: an exact barcode or SKU match goes
  // straight into the sale.
  async function handleEnter() {
    const code = text.trim()
    if (!code) return
    try {
      const exact = await posApi.searchProducts(storeId, { code })
      if (exact.length === 1) {
        if (exact[0].stock < 1) {
          onNotice(`${exact[0].title} is out of stock`)
        } else {
          onAdd(exact[0])
          setText('')
        }
      } else if (products.length === 1 && products[0].stock > 0) {
        onAdd(products[0])
        setText('')
      } else {
        onNotice(`No product with the code "${code}"`)
      }
    } catch (err) {
      onNotice(errorMessage(err))
    }
  }

  return (
    <section aria-label="Products" className="flex flex-col p-5 gap-4 lg:min-h-0 lg:overflow-y-auto">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="pos-search" className="text-xs font-semibold text-text-secondary">
          Scan a barcode or search products
        </label>
        <input
          id="pos-search"
          ref={searchRef}
          autoFocus
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleEnter()
            }
          }}
          placeholder="Barcode, SKU or product name"
          className="h-14 rounded-[10px] border border-border bg-white px-4 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        <div className="min-h-5 text-sm" role="status" aria-live="polite">
          {notice && <span className="font-medium text-text-secondary">{notice}</span>}
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {loading && products.length === 0 ? (
        <Spinner label="Loading products" />
      ) : products.length === 0 ? (
        <p className="text-sm text-text-secondary">No products found.</p>
      ) : (
        <ul className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {products.map((p) => {
            const out = p.stock < 1
            return (
              <li key={p.id}>
                <button
                  onClick={() => {
                    onAdd(p)
                    searchRef.current?.focus()
                  }}
                  disabled={out}
                  className="w-full h-full text-left rounded-xl border border-border bg-white p-3 flex flex-col gap-1 hover:border-brand disabled:opacity-60 disabled:hover:border-border"
                >
                  {p.image ? (
                    <img src={p.image} alt="" className="h-20 w-full object-cover rounded-lg mb-1" />
                  ) : (
                    <span aria-hidden="true" className="h-20 w-full rounded-lg bg-bg mb-1" />
                  )}
                  <span className="text-sm font-semibold leading-tight">{p.title}</span>
                  <span className="text-sm tabular-nums">{money(p.price)}</span>
                  <span className={`text-xs font-medium ${out ? 'text-danger' : p.stock <= 5 ? 'text-warning' : 'text-text-secondary'}`}>
                    {out ? 'Out of stock' : `${p.stock} in stock`}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
