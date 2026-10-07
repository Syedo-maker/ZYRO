import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Fades and lifts its children into view once, the first time they are scrolled to.
 *
 * One IntersectionObserver per element and two CSS properties, rather than an animation library:
 * the landing page is the first thing a visitor loads and it should not pull in a motion runtime to
 * do a fade.
 *
 * A visitor who has asked their system for less motion gets the content immediately, fully visible,
 * with no transition at all. That is checked before the observer is ever created, so there is no
 * flash of hidden content for them.
 */
export function Reveal({ children, delayMs = 0, className = '' }: { children: ReactNode; delayMs?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const prefersReduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  // No observer (an old browser, or a test environment) means the content must start visible rather
  // than wait for a reveal that will never come. Decided here rather than in an effect, so there is
  // no render where it is hidden.
  const cannotObserve = typeof IntersectionObserver === 'undefined'
  const [shown, setShown] = useState(prefersReduced || cannotObserve)

  useEffect(() => {
    if (prefersReduced || cannotObserve || shown) return
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        setShown(true)
        observer.disconnect()
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [prefersReduced, cannotObserve, shown])

  return (
    <div
      ref={ref}
      className={`${className} ${prefersReduced ? '' : 'transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none'}`}
      style={prefersReduced ? undefined : { opacity: shown ? 1 : 0, transform: shown ? 'none' : 'translateY(18px)', transitionDelay: `${delayMs}ms` }}
    >
      {children}
    </div>
  )
}
