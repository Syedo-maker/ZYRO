import { createContext, useContext } from 'react'
import type { ToastTone } from '../../lib/toasts'

/** What a page calls to show a toast (components/ui/Toast.tsx draws them). */
export type ToastApi = Record<ToastTone, (message: string) => void>

export const ToastContext = createContext<ToastApi | null>(null)

/** `toast.success('Product saved')`, and the same for error, warning and info. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast needs a ToastProvider above it')
  return api
}
