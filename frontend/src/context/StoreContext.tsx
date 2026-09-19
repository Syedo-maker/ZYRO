import { createContext, useContext } from 'react'
import type { StoreProfile } from '../types/commerce'

/** The store a shopper is browsing, loaded once by StorefrontLayout from the :storeId in the URL. */
export const StoreContext = createContext<StoreProfile | null>(null)

export function useStore(): StoreProfile {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used within a StorefrontLayout')
  return store
}
