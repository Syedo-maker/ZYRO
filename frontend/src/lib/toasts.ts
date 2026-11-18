/**
 * The queue behind the toasts (components/ui/Toast.tsx), kept apart from React so its rules can be
 * tested on their own (tests/toasts.test.ts). A toast is a short, passing confirmation of an action
 * that has no other visible result: "Product saved", "Order cancelled". Anything the visitor must act
 * on, or read beside a form, stays an inline notice (components/ui/Alert.tsx).
 */

export type ToastTone = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: number
  tone: ToastTone
  message: string
}

/** How many toasts show at once; a new one beyond this pushes out the oldest. */
export const MAX_TOASTS = 4

/**
 * How long each tone stays up. Success and info are a glance; an error or a warning is read, so it
 * stays a second longer. Hovering or focusing a toast pauses its clock (WCAG 2.2.1).
 */
export const TOAST_DURATION_MS: Record<ToastTone, number> = {
  success: 4000,
  info: 4000,
  warning: 5000,
  error: 5000,
}

/** The list with `toast` added at the end, the oldest dropped past MAX_TOASTS. The same message
 *  twice in a row (a double click) replaces the earlier one instead of stacking a copy. */
export function addToast(list: readonly Toast[], toast: Toast, max = MAX_TOASTS): Toast[] {
  const withoutRepeat = list.filter((t) => !(t.tone === toast.tone && t.message === toast.message))
  return [...withoutRepeat, toast].slice(-max)
}

export function removeToast(list: readonly Toast[], id: number): Toast[] {
  return list.filter((t) => t.id !== id)
}
