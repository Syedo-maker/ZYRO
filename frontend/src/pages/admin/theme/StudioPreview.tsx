import { Monitor, Smartphone, Tablet } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { StoreTheme, ThemeTokens } from '../../../lib/storeTheme'
import { PREVIEW_MESSAGE, PREVIEW_READY } from '../../../lib/themePreview'

const DEVICES = {
  desktop: { label: 'Desktop', width: 1280, icon: Monitor },
  tablet: { label: 'Tablet', width: 820, icon: Tablet },
  mobile: { label: 'Mobile', width: 390, icon: Smartphone },
} as const
type Device = keyof typeof DEVICES

export type PreviewPage = 'home' | 'product' | 'cart' | 'checkout'
const PAGES: { id: PreviewPage; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'product', label: 'Product' },
  { id: 'cart', label: 'Cart' },
  { id: 'checkout', label: 'Checkout' },
]

/**
 * The real storefront in a frame, wearing the draft (Store Themes, Part 2). The draft is handed over
 * with postMessage whenever it changes, so the preview updates in place without reloading; switching
 * device only resizes the frame, and switching page loads that page once. The frame is scaled to fit,
 * so the desktop view is a true 1280-pixel layout, not a squeezed one.
 */
export function StudioPreview({ storeId, productId, theme, tokens }: { storeId: string; productId: string | null; theme: StoreTheme; tokens: ThemeTokens }) {
  const [device, setDevice] = useState<Device>('desktop')
  const [page, setPage] = useState<PreviewPage>('home')
  const frame = useRef<HTMLIFrameElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })
  const latest = useRef({ theme, tokens })

  const send = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ type: PREVIEW_MESSAGE, ...latest.current }, window.location.origin)
  }, [])

  // Each change of the draft goes straight to the frame.
  useEffect(() => {
    latest.current = { theme, tokens }
    send()
  }, [theme, tokens, send])

  // A page in the frame (after loading, or after the owner clicked a link inside it) asks for the draft.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return
      if ((event.data as { type?: string })?.type === PREVIEW_READY) send()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [send])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const width = DEVICES[device].width
  const scale = Math.min(1, size.width / width)
  const path = {
    home: `/store/${storeId}`,
    product: productId ? `/store/${storeId}/products/${productId}` : `/store/${storeId}/products`,
    cart: `/store/${storeId}/cart`,
    checkout: `/store/${storeId}/checkout`,
  }[page]

  const segment = (active: boolean) =>
    `inline-flex min-h-9 items-center gap-1.5 rounded-control px-3 text-xs font-semibold transition-colors ${active ? 'bg-brand-soft text-brand-ink' : 'text-text-secondary hover:text-text'}`

  return (
    <section aria-label="Live preview" className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Page" className="flex flex-wrap gap-1 rounded-control border border-border bg-surface p-1">
          {PAGES.map((p) => (
            <button key={p.id} type="button" aria-pressed={page === p.id} onClick={() => setPage(p.id)} className={segment(page === p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Device" className="flex gap-1 rounded-control border border-border bg-surface p-1">
          {(Object.keys(DEVICES) as Device[]).map((d) => {
            const Icon = DEVICES[d].icon
            return (
              <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)} className={segment(device === d)}>
                <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                <span className="hidden sm:inline">{DEVICES[d].label}</span>
                <span className="sr-only sm:hidden">{DEVICES[d].label}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div ref={box} className="relative min-h-[420px] flex-1 overflow-hidden rounded-2xl border border-border bg-subtle">
        <div className="absolute left-1/2 top-0 h-full" style={{ width: width * scale, transform: 'translateX(-50%)' }}>
          <iframe
            ref={frame}
            key={path}
            title={`Preview of your store, ${PAGES.find((p) => p.id === page)?.label} page, ${DEVICES[device].label}`}
            src={path}
            onLoad={send}
            className="origin-top-left border-0 bg-bg"
            style={{ width, height: size.height / scale, transform: `scale(${scale})` }}
          />
        </div>
      </div>
      <p className="text-xs text-text-muted">Only you see this draft. Shoppers see your published theme until you press Publish.</p>
    </section>
  )
}
