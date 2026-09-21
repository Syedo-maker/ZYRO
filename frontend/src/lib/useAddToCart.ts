import { useState } from 'react'
import { useCart } from '../context/CartContext'
import { errorMessage } from './ordersApi'
import type { Product } from '../types/api'

/** Adds a product to the cart and keeps the "added" or error message for the page to announce. */
export function useAddToCart() {
  const { add } = useCart()
  const [addingId, setAddingId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)

  async function addToCart(product: Pick<Product, 'id' | 'title'>, quantity = 1) {
    setAddingId(product.id)
    setMessage(null)
    try {
      await add(product.id, quantity)
      setMessage({ tone: 'success', text: `${product.title} added to your cart.` })
    } catch (e) {
      setMessage({ tone: 'error', text: errorMessage(e) })
    } finally {
      setAddingId(null)
    }
  }

  return { addingId, message, addToCart, clearMessage: () => setMessage(null) }
}
