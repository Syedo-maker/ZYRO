import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '../lib/apiClient'
import { posApi } from '../lib/posApi'
import type { CartLine, HeldSale, ManualDiscount, PosCustomer, PosProduct, PosQuote, PosSession, PosShift } from '../types/pos'

interface PosContextValue {
  storeId: string
  session: PosSession
  shift: PosShift | null
  setShift: (shift: PosShift | null) => void
  refreshShift: () => Promise<void>

  cart: CartLine[]
  discount: ManualDiscount | null
  customer: PosCustomer | null
  quote: PosQuote | null
  quoteError: string | null
  quoting: boolean

  addProduct: (product: PosProduct) => void
  setQuantity: (productId: string, quantity: number) => void
  removeLine: (productId: string) => void
  setDiscount: (discount: ManualDiscount | null) => void
  setCustomer: (customer: PosCustomer | null) => void
  clearCart: () => void
  loadHeld: (held: HeldSale) => void
}

const PosContext = createContext<PosContextValue | null>(null)

interface PersistedCart {
  cart: CartLine[]
  discount: ManualDiscount | null
  customer: PosCustomer | null
}

// The cart survives a page reload (a cashier bumping F5 must not lose a customer's basket),
// but not closing the tab. Storage can be unavailable, so every access is guarded.
const cartKey = (storeId: string) => `zyro-pos-cart:${storeId}`
function readCart(storeId: string): PersistedCart {
  try {
    const raw = sessionStorage.getItem(cartKey(storeId))
    if (raw) return JSON.parse(raw) as PersistedCart
  } catch {
    /* fall through to an empty cart */
  }
  return { cart: [], discount: null, customer: null }
}

export function PosProvider({
  storeId,
  session,
  initialShift,
  children,
}: {
  storeId: string
  session: PosSession
  initialShift: PosShift | null
  children: ReactNode
}) {
  const [shift, setShift] = useState<PosShift | null>(initialShift)
  const [{ cart, discount, customer }, setState] = useState<PersistedCart>(() => readCart(storeId))
  const [quote, setQuote] = useState<PosQuote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [quoting, setQuoting] = useState(false)

  useEffect(() => {
    try {
      sessionStorage.setItem(cartKey(storeId), JSON.stringify({ cart, discount, customer }))
    } catch {
      /* not persisted; the register still works */
    }
  }, [storeId, cart, discount, customer])

  // Price the cart on the server after every change, so the totals shown are the totals
  // that will be charged. A counter drops answers that arrive out of order.
  const seq = useRef(0)
  useEffect(() => {
    if (cart.length === 0) {
      seq.current++
      setQuote(null)
      setQuoteError(null)
      setQuoting(false)
      return
    }
    const mine = ++seq.current
    setQuoting(true)
    const timer = setTimeout(() => {
      posApi
        .quote(storeId, cart.map((l) => ({ productId: l.productId, quantity: l.quantity })), discount)
        .then((q) => {
          if (mine !== seq.current) return
          setQuote(q)
          setQuoteError(null)
        })
        .catch((err: unknown) => {
          if (mine !== seq.current) return
          setQuote(null)
          setQuoteError(err instanceof ApiError ? (err.detail ?? err.message) : 'Could not price this sale. Check your connection.')
        })
        .finally(() => {
          if (mine === seq.current) setQuoting(false)
        })
    }, 200)
    return () => clearTimeout(timer)
  }, [storeId, cart, discount])

  const refreshShift = useCallback(async () => {
    setShift(await posApi.currentShift(storeId))
  }, [storeId])

  const value = useMemo<PosContextValue>(
    () => ({
      storeId,
      session,
      shift,
      setShift,
      refreshShift,
      cart,
      discount,
      customer,
      quote,
      quoteError,
      quoting,
      addProduct: (p) =>
        setState((s) => {
          const existing = s.cart.find((l) => l.productId === p.id)
          const cartNext = existing
            ? s.cart.map((l) => (l.productId === p.id ? { ...l, quantity: l.quantity + 1, stock: p.stock } : l))
            : [...s.cart, { productId: p.id, title: p.title, quantity: 1, unitPrice: p.price, stock: p.stock, image: p.image }]
          return { ...s, cart: cartNext }
        }),
      setQuantity: (productId, quantity) =>
        setState((s) => ({
          ...s,
          cart: quantity < 1 ? s.cart.filter((l) => l.productId !== productId) : s.cart.map((l) => (l.productId === productId ? { ...l, quantity } : l)),
        })),
      removeLine: (productId) => setState((s) => ({ ...s, cart: s.cart.filter((l) => l.productId !== productId) })),
      setDiscount: (d) => setState((s) => ({ ...s, discount: d })),
      setCustomer: (c) => setState((s) => ({ ...s, customer: c })),
      clearCart: () => setState({ cart: [], discount: null, customer: null }),
      loadHeld: (held) =>
        setState({
          cart: held.items.map((i) => ({ productId: i.productId, title: i.title, quantity: i.quantity, unitPrice: null, stock: null, image: null })),
          discount: held.discount,
          customer: held.customerId ? { id: held.customerId, name: held.customerName, email: null, phone: null } : null,
        }),
    }),
    [storeId, session, shift, refreshShift, cart, discount, customer, quote, quoteError, quoting]
  )

  return <PosContext.Provider value={value}>{children}</PosContext.Provider>
}

export function usePos(): PosContextValue {
  const ctx = useContext(PosContext)
  if (!ctx) throw new Error('usePos must be used within a PosLayout')
  return ctx
}
