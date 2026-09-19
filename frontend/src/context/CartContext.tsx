import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { cartApi } from '../lib/storefrontApi'
import type { Cart } from '../types/commerce'

interface CartContextValue {
  cart: Cart | null
  /** True until the first cart load finishes. */
  isLoading: boolean
  itemCount: number
  reload: () => Promise<void>
  add: (productId: string, quantity?: number) => Promise<void>
  setQuantity: (productId: string, quantity: number) => Promise<void>
  remove: (productId: string) => Promise<void>
}

const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ storeId, children }: { storeId: string; children: ReactNode }) {
  const { isLoading: authLoading } = useAuth()
  const [cart, setCart] = useState<Cart | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const reload = useCallback(async () => {
    setCart(await cartApi.get(storeId))
  }, [storeId])

  // Wait for the silent login restore to finish before the first load: otherwise a
  // returning shopper's first request would be treated as a guest and show the wrong cart.
  useEffect(() => {
    if (authLoading) return
    let cancelled = false
    reload()
      .catch(() => {
        if (!cancelled) setCart(null)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [authLoading, reload])

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      isLoading,
      itemCount: cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0,
      reload,
      // Mutations return the updated cart, so there is no second request to refetch it.
      add: async (productId, quantity = 1) => setCart(await cartApi.add(storeId, productId, quantity)),
      setQuantity: async (productId, quantity) => setCart(await cartApi.setQuantity(storeId, productId, quantity)),
      remove: async (productId) => setCart(await cartApi.remove(storeId, productId)),
    }),
    [cart, isLoading, reload, storeId]
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within a CartProvider')
  return ctx
}
