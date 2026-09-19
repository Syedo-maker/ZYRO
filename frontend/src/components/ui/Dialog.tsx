import { useEffect, useId, useRef, type ReactNode } from 'react'

interface DialogProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** Width: `md` for short confirmations, `lg` for forms and receipts. */
  size?: 'md' | 'lg'
}

const SIZE_CLASSES = {
  md: 'w-[min(440px,calc(100vw-32px))]',
  lg: 'w-[min(640px,calc(100vw-32px))]',
} as const

/**
 * A modal built on the native <dialog> element: the browser traps focus inside it, closes
 * it on Escape, and restores focus to the button that opened it.
 */
export function Dialog({ open, title, onClose, children, size = 'md' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={titleId}
      className={`m-auto max-h-[calc(100vh-32px)] overflow-y-auto rounded-2xl border border-border p-6 backdrop:bg-black/40 ${SIZE_CLASSES[size]}`}
    >
      <h2 id={titleId} className="font-display text-lg font-bold mb-3">
        {title}
      </h2>
      {children}
    </dialog>
  )
}
