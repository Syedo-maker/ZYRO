// The walkthrough videos' pointer overlay (see README.md). Loaded into every page of a filmed chapter
// with addInitScript, so it is there after every page load; it lives on <html>, outside the app's
// own elements, so client-side route changes leave it alone.
//
// Playwright's videos do not show the system cursor, so this draws one, plus what each action is:
// a ripple where a click lands, an outline around the element, and an arrow with a short label
// ("Click: Add product"). It never changes the app: one fixed layer, pointer-events: none, the
// highest z-index, nothing inserted into the page's own layout.
;(() => {
  if (window.__demoOverlay) return
  const Z = '2147483647'
  const KEY = '__demoCursor'
  const ORANGE = '#E8703D'
  const GREEN = '#0B3B33'
  const CREAM = '#F4F3EE'

  let root, cursor, outline, bubble, arrow, keyHint
  const saved = (() => {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) || 'null')
    } catch {
      return null
    }
  })()
  let pos = saved || { x: Math.round(innerWidth * 0.55), y: Math.round(innerHeight * 0.45) }

  const css = (el, styles) => Object.assign(el.style, styles)

  function build() {
    if (root && root.isConnected) return
    root = document.createElement('div')
    root.id = '__demo-overlay'
    root.setAttribute('aria-hidden', 'true')
    // A manual popover lives in the browser's top layer, so it can sit above a modal <dialog>
    // (which no z-index can beat). It takes no focus and closes on nothing.
    root.setAttribute('popover', 'manual')
    css(root, { position: 'fixed', inset: '0', zIndex: Z, pointerEvents: 'none', overflow: 'hidden', contain: 'strict', margin: '0', padding: '0', border: '0', background: 'transparent', width: '100vw', height: '100vh', maxWidth: 'none', maxHeight: 'none' })

    outline = document.createElement('div')
    css(outline, { position: 'fixed', border: `3px solid ${ORANGE}`, borderRadius: '10px', boxShadow: `0 0 0 6px rgba(232,112,61,.22)`, opacity: '0', transition: 'opacity .2s, left .25s, top .25s, width .25s, height .25s', pointerEvents: 'none' })

    bubble = document.createElement('div')
    css(bubble, { position: 'fixed', background: GREEN, color: CREAM, font: '700 20px/1.25 "Segoe UI", system-ui, sans-serif', padding: '9px 16px', borderRadius: '12px', boxShadow: '0 6px 24px rgba(0,0,0,.28)', whiteSpace: 'nowrap', maxWidth: '640px', overflow: 'hidden', textOverflow: 'ellipsis', opacity: '0', transition: 'opacity .2s', pointerEvents: 'none' })

    arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    arrow.setAttribute('width', '1')
    arrow.setAttribute('height', '1')
    css(arrow, { position: 'fixed', left: '0', top: '0', width: '100vw', height: '100vh', overflow: 'visible', opacity: '0', transition: 'opacity .2s', pointerEvents: 'none' })
    arrow.innerHTML = `<defs><marker id="__demoHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${ORANGE}"/></marker></defs><line x1="0" y1="0" x2="0" y2="0" stroke="${ORANGE}" stroke-width="4" stroke-linecap="round" marker-end="url(#__demoHead)"/>`

    keyHint = document.createElement('div')
    css(keyHint, { position: 'fixed', right: '28px', top: '50%', transform: 'translateY(-50%)', background: GREEN, color: CREAM, font: '700 22px/1.2 "Segoe UI", system-ui, sans-serif', padding: '12px 18px', borderRadius: '14px', boxShadow: '0 6px 24px rgba(0,0,0,.28)', opacity: '0', transition: 'opacity .2s', pointerEvents: 'none', textAlign: 'center', whiteSpace: 'pre-line' })

    cursor = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    cursor.setAttribute('width', '34')
    cursor.setAttribute('height', '40')
    cursor.setAttribute('viewBox', '0 0 34 40')
    css(cursor, { position: 'fixed', left: '0', top: '0', transform: `translate(${pos.x}px, ${pos.y}px)`, transition: 'transform 0s', filter: 'drop-shadow(0 3px 4px rgba(0,0,0,.45))', pointerEvents: 'none' })
    cursor.innerHTML = '<path d="M3 2 L3 32 L11 25 L16.5 37 L22 34.5 L16.5 23 L27 23 Z" fill="#ffffff" stroke="#111111" stroke-width="2.4" stroke-linejoin="round"/>'

    root.append(outline, arrow, bubble, keyHint, cursor)
    document.documentElement.appendChild(root)
    try {
      root.showPopover()
    } catch {}
  }

  /** Puts the layer back on top once a modal dialog opens (the newest top-layer element is drawn last). */
  function raise() {
    build()
    try {
      if (!root.matches(':popover-open')) root.showPopover()
      const dialog = document.querySelector('dialog:modal')
      if (dialog && !dialog.__demoRaised) {
        dialog.__demoRaised = true
        root.hidePopover()
        root.showPopover()
      }
    } catch {}
  }

  function remember() {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(pos))
    } catch {}
  }

  /** Glides the cursor to (x, y) in `ms`; the tip of the arrow is the point. */
  function move(x, y, ms = 700) {
    raise()
    pos = { x: Math.round(x), y: Math.round(y) }
    cursor.style.transition = `transform ${ms}ms cubic-bezier(.45,.05,.25,1)`
    cursor.style.transform = `translate(${pos.x - 3}px, ${pos.y - 2}px)`
    remember()
  }

  /** A ripple where a click lands. */
  function ripple(x = pos.x, y = pos.y) {
    raise()
    for (const [delay, size] of [
      [0, 74],
      [120, 46],
    ]) {
      const r = document.createElement('div')
      css(r, { position: 'fixed', left: `${x}px`, top: `${y}px`, width: '14px', height: '14px', margin: '-7px 0 0 -7px', borderRadius: '50%', border: `4px solid ${ORANGE}`, background: 'rgba(232,112,61,.25)', opacity: '0.95', transform: 'scale(1)', transition: `transform .65s ease-out ${delay}ms, opacity .65s ease-out ${delay}ms`, pointerEvents: 'none' })
      root.insertBefore(r, cursor)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          r.style.transform = `scale(${size / 14})`
          r.style.opacity = '0'
        }),
      )
      setTimeout(() => r.remove(), 900 + delay)
    }
  }

  /**
   * Outlines `rect` and points at it with an arrow and a label. The label goes above the element,
   * or below, right or left, whichever fits on screen without covering the element itself;
   * `prefer` names the side to try first (when the usual one would cover something that matters).
   */
  function show(rect, text, prefer) {
    raise()
    const pad = 6
    const r = { left: rect.x - pad, top: rect.y - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    css(outline, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, opacity: '1' })
    bubble.textContent = text
    bubble.style.opacity = '0'
    bubble.style.left = '0px'
    bubble.style.top = '0px'
    const bw = Math.min(bubble.offsetWidth, innerWidth - 32)
    const bh = bubble.offsetHeight
    const gap = 46
    const W = innerWidth
    const H = innerHeight
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const clampX = (x) => Math.max(16, Math.min(W - bw - 16, x))
    const clampY = (y) => Math.max(16, Math.min(H - bh - 16, y))
    const options = [
      { side: 'above', x: clampX(cx - bw / 2), y: r.top - gap - bh, ok: r.top - gap - bh >= 12 },
      { side: 'below', x: clampX(cx - bw / 2), y: r.top + r.height + gap, ok: r.top + r.height + gap + bh <= H - 12 },
      { side: 'right', x: r.left + r.width + gap, y: clampY(cy - bh / 2), ok: r.left + r.width + gap + bw <= W - 12 },
      { side: 'left', x: r.left - gap - bw, y: clampY(cy - bh / 2), ok: r.left - gap - bw >= 12 },
    ]
    // A huge element (a whole panel): put the label inside its top edge rather than off screen.
    if (prefer) options.sort((a, b) => (b.side === prefer) - (a.side === prefer))
    const pick = options.find((o) => o.ok) || { side: 'inside', x: clampX(cx - bw / 2), y: clampY(r.top + 12) }
    css(bubble, { left: `${pick.x}px`, top: `${pick.y}px`, opacity: '1' })
    // The arrow runs from the label's edge to the element's edge.
    const from = {
      above: [pick.x + bw / 2, pick.y + bh + 4],
      below: [pick.x + bw / 2, pick.y - 4],
      right: [pick.x - 4, pick.y + bh / 2],
      left: [pick.x + bw + 4, pick.y + bh / 2],
      inside: [pick.x + bw / 2, pick.y + bh + 4],
    }[pick.side]
    const to = {
      above: [Math.max(r.left + 10, Math.min(r.left + r.width - 10, from[0])), r.top - 3],
      below: [Math.max(r.left + 10, Math.min(r.left + r.width - 10, from[0])), r.top + r.height + 3],
      right: [r.left + r.width + 3, Math.max(r.top + 8, Math.min(r.top + r.height - 8, from[1]))],
      left: [r.left - 3, Math.max(r.top + 8, Math.min(r.top + r.height - 8, from[1]))],
      inside: [from[0], from[1] + 18],
    }[pick.side]
    const line = arrow.querySelector('line')
    line.setAttribute('x1', from[0])
    line.setAttribute('y1', from[1])
    line.setAttribute('x2', to[0])
    line.setAttribute('y2', to[1])
    arrow.style.opacity = '1'
  }

  /** A label with no element (scrolling, a key with nothing focused): at the right edge, mid-screen. */
  function hint(text) {
    raise()
    keyHint.textContent = text
    keyHint.style.opacity = '1'
  }

  function hide() {
    if (!root) return
    for (const el of [outline, bubble, arrow, keyHint]) el.style.opacity = '0'
  }

  window.__demoOverlay = { move, ripple, show, hint, hide, get position() { return pos } }
  if (document.documentElement) build()
  else document.addEventListener('readystatechange', build, { once: true })
  // Some apps replace <html>'s children on their own; put the layer back if it goes.
  new MutationObserver(() => root && !root.isConnected && document.documentElement.appendChild(root)).observe(document, { childList: true, subtree: false })
})()
