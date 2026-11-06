import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import { addToast, removeToast, TOAST_DURATION_MS, type Toast, type ToastTone } from '../../lib/toasts'
import { ToastContext, type ToastApi } from './useToast'

/**
 * One toast system for the whole app (B3). A toast confirms an action that has no other visible
 * result ("Product saved", "Order cancelled") and leaves by itself after 4 to 5 seconds; it has a close
 * button, stacks with others, and pauses while hovered or focused. Inline notices and form errors stay
 * where they are: a toast never replaces something the visitor needs to read beside a form.
 *
 * Screen readers hear each toast once, from two always-present live regions (polite for success and
 * info, assertive for errors and warnings); the visible stack itself is a plain list so its close
 * buttons can be reached. With reduced motion asked for, toasts simply appear.
 */

const TONE_CLASSES: Record<ToastTone, string> = {
  success: 'bg-success-soft text-success border-success/40',
  error: 'bg-danger-soft text-danger border-danger/40',
  warning: 'bg-warning-soft text-warning border-warning/40',
  // Neutral, with a lime icon, so lime never reads as a status (the same rule as Alert).
  info: 'bg-surface-2 text-text border-border',
}
const ICONS = { success: CircleCheck, error: CircleAlert, warning: TriangleAlert, info: Info }
const ICON_COLOUR: Record<ToastTone, string> = { success: 'text-success', error: 'text-danger', warning: 'text-warning', info: 'text-brand-ink' }
const LABEL: Record<ToastTone, string> = { success: 'Done', error: 'Error', warning: 'Warning', info: 'Note' }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [announcement, setAnnouncement] = useState<{ polite: string; assertive: string }>({ polite: '', assertive: '' })
  const nextId = useRef(0)

  const show = useCallback((tone: ToastTone, message: string) => {
    nextId.current += 1
    const toast = { id: nextId.current, tone, message }
    setToasts((list) => addToast(list, toast))
    setAnnouncement(tone === 'error' || tone === 'warning' ? { polite: '', assertive: message } : { polite: message, assertive: '' })
  }, [])
  const dismiss = useCallback((id: number) => setToasts((list) => removeToast(list, id)), [])

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => show('success', m),
      error: (m) => show('error', m),
      warning: (m) => show('warning', m),
      info: (m) => show('info', m),
    }),
    [show],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="sr-only">
        {announcement.polite}
      </div>
      <div aria-live="assertive" className="sr-only">
        {announcement.assertive}
      </div>
      {toasts.length > 0 && (
        <section aria-label="Notifications" className="pointer-events-none fixed inset-x-4 bottom-4 z-[var(--z-toast)] sm:left-auto sm:w-96">
          <ol className="flex flex-col gap-2">
            {toasts.map((t) => (
              <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
            ))}
          </ol>
        </section>
      )}
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false)
  const remaining = useRef(TOAST_DURATION_MS[toast.tone])

  // The clock runs only while the toast is neither hovered nor focused; it resumes with what was left.
  useEffect(() => {
    if (paused) return
    const started = Date.now()
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - started))
    }
  }, [paused, toast.id, onDismiss])

  const Icon = ICONS[toast.tone]
  return (
    <li
      data-toast={toast.tone}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg motion-safe:animate-fade-up ${TONE_CLASSES[toast.tone]}`}
    >
      <Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${ICON_COLOUR[toast.tone]}`} strokeWidth={2} />
      <p className="min-w-0 flex-1">
        <span className="sr-only">{LABEL[toast.tone]}: </span>
        {toast.message}
      </p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="-m-1 rounded-md p-1 text-current opacity-80 transition-opacity hover:opacity-100"
      >
        <X aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
      </button>
    </li>
  )
}
