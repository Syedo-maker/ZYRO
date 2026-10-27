// Accessibility and interaction audit across every screen, measured in a real browser.
//
// This is a measuring instrument, not a pass/fail gate: it reports what it finds so the findings can
// be fixed, and it is run again afterwards to show they are gone. The rules it checks are the ones
// the ui-ux-pro-max skill ranks as critical, with the web-correct thresholds:
//
//   - Target size: WCAG 2.2 Target Size (Minimum) is 24 CSS px for web, with a spacing exception.
//     44pt and 48dp are the iOS and Android numbers and do not apply to a web page. The register is
//     reported separately at 44 px, because it is genuinely used on a phone or tablet at a counter.
//   - Every image carries an alt attribute (empty is correct for decorative images).
//   - Every control that shows only an icon has an accessible name.
//   - Every form field has a label, not just a placeholder.
//   - Focus is never removed without something visible put back.
//   - Heading levels are never skipped.
//
// Setup and run: backend (npx tsx scripts/e2e-server.ts) and Redis, and `npm run dev` in the
// frontend, then: node e2e/a11y-audit.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (emails and slugs use the e2e- prefix).
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
const SHOTS = path.join(import.meta.dirname, 'shots')
fs.mkdirSync(SHOTS, { recursive: true })

const suffix = Date.now().toString(36)
const password = 'password123'
const findings = []
let screensChecked = 0
let textElementsChecked = 0

async function api(method, p, { token, body } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text()
  return { status: res.status, json: t ? JSON.parse(t) : null }
}

/**
 * Everything below runs inside the page. It deliberately reports the element's own markup so a
 * finding can be traced back to a component without guessing.
 */
const AUDIT = (minTarget) => {
  const out = []
  const describe = (el) => {
    const tag = el.tagName.toLowerCase()
    const id = el.id ? `#${el.id}` : ''
    const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.')
    const text = (el.innerText || el.value || '').trim().slice(0, 40).replace(/\s+/g, ' ')
    return `${tag}${id}${cls ? '.' + cls : ''}${text ? ` "${text}"` : ''}`
  }
  /**
   * Whether a person can actually see this, which is not the same as the element's own style
   * saying so. A control inside a closed drawer can sit under `visibility: hidden` on an ancestor:
   * it keeps its layout box, so its rectangle still has a size, while nothing renders. Checking the
   * element alone reported a drawer full of perfectly good buttons as unlabelled, because
   * `innerText` is empty for anything not rendered. `checkVisibility` asks the browser instead.
   */
  const visible = (el) => {
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true, contentVisibilityAuto: true })
    }
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'
  }
  const accessibleName = (el) => {
    const aria = el.getAttribute('aria-label')
    if (aria && aria.trim()) return aria.trim()
    const labelledby = el.getAttribute('aria-labelledby')
    if (labelledby) {
      const t = labelledby.split(/\s+/).map((i) => document.getElementById(i)?.innerText || '').join(' ').trim()
      if (t) return t
    }
    const title = el.getAttribute('title')
    if (title && title.trim()) return title.trim()
    const text = (el.innerText || '').trim()
    if (text) return text
    const img = el.querySelector('img[alt]')
    if (img && img.alt.trim()) return img.alt.trim()
    const sr = el.querySelector('.sr-only')
    if (sr && sr.innerText.trim()) return sr.innerText.trim()
    return ''
  }

  // ---- Target size -------------------------------------------------------------------------------
  /*
   * WCAG 2.2 Target Size (Minimum) is 24 CSS px for the web, and it has exceptions that matter. A
   * small target passes when it is inline in a sentence, and it passes under the **spacing**
   * exception when a 24px circle centred on it touches no other target's circle. Without that
   * second rule a perfectly usable navigation bar of well-separated text links reads as 150
   * failures, which would push someone towards "fixing" a design that was never broken.
   */
  const interactive = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], summary')]
  const shown = interactive.filter(visible)
  const boxes = shown.map((el) => {
    const r = el.getBoundingClientRect()
    return { el, r, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
  })

  for (const b of boxes) {
    const { el, r } = b
    if (r.width >= minTarget && r.height >= minTarget) continue

    // Exception: a link sitting inside a longer run of text.
    const parentText = (el.parentElement?.innerText || '').trim()
    const ownText = (el.innerText || '').trim()
    if (el.tagName === 'A' && parentText.length > ownText.length + 10) continue

    // Exception: spacing. No other target's 24px circle overlaps this one's.
    const crowded = boxes.some((o) => o !== b && Math.hypot(o.cx - b.cx, o.cy - b.cy) < minTarget)
    if (!crowded) continue

    out.push({
      kind: 'target-size',
      detail: `${Math.round(r.width)}x${Math.round(r.height)} (min ${minTarget}) and crowded by a neighbour`,
      el: describe(el),
    })
  }

  // ---- Colour contrast: text (WCAG 1.4.3) and the borders that identify a field (WCAG 1.4.11) -------
  /*
   * Added after this audit reported zero findings while three text-contrast failures sat on the
   * landing page, worked out by hand. It never measured colour at all. It does now, and it measures
   * what the browser actually paints: every colour, whatever form CSS wrote it in (oklch, color-mix,
   * an opacity modifier), is resolved to sRGB by drawing it on a canvas, and a translucent background
   * is composited over whatever lies behind it, ancestor by ancestor.
   */
  const ctx = (() => {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    return c.getContext('2d', { willReadFrequently: true })
  })()
  const rgba = (css) => {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000'
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return [r, g, b, a / 255]
  }
  const over = ([r, g, b, a], [br, bg, bb]) => [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)]
  const lum = ([r, g, b]) => {
    const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
    return (x + 0.05) / (y + 0.05)
  }
  /** The opaque colour behind an element: translucent backgrounds composited up the ancestor chain. */
  const backdrop = (el) => {
    const layers = []
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = rgba(getComputedStyle(n).backgroundColor)
      if (c[3] > 0) {
        layers.push(c)
        if (c[3] >= 1) break
      }
    }
    let base = [255, 255, 255]
    for (const layer of layers.reverse()) base = over(layer, base)
    return base
  }
  const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  const decorative = (el) => el.closest('[aria-hidden="true"], .sr-only, [inert]') !== null

  const textOwners = new Set()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (t) => (t.nodeValue.trim().length > 1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  })
  for (let t = walker.nextNode(); t; t = walker.nextNode()) textOwners.add(t.parentElement)

  let textChecked = 0
  for (const el of textOwners) {
    if (!el || !visible(el) || decorative(el)) continue
    if (el.closest('button:disabled, [aria-disabled="true"], input:disabled, select:disabled')) continue
    const cs = getComputedStyle(el)
    const size = parseFloat(cs.fontSize)
    const weight = parseInt(cs.fontWeight, 10) || 400
    const large = size >= 24 || (size >= 18.66 && weight >= 700)
    const need = large ? 3 : 4.5
    const bg = backdrop(el)
    const fg = over(rgba(cs.color), bg)
    const ratio = contrast(fg, bg)
    textChecked += 1
    if (ratio + 0.005 < need) {
      out.push({
        kind: 'text-contrast',
        detail: `${ratio.toFixed(2)}:1, needs ${need} (${Math.round(size)}px ${weight}${large ? ', large' : ''}) ${hex(fg)} on ${hex(bg)}`,
        el: describe(el),
      })
    }
  }

  for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=range]), select, textarea')) {
    if (!visible(el) || decorative(el)) continue
    const cs = getComputedStyle(el)
    if (parseFloat(cs.borderTopWidth) === 0) continue
    const outside = backdrop(el.parentElement)
    const border = over(rgba(cs.borderTopColor), outside)
    const ratio = contrast(border, outside)
    if (ratio + 0.005 < 3) {
      out.push({ kind: 'field-boundary-contrast', detail: `border ${ratio.toFixed(2)}:1, needs 3 (WCAG 1.4.11) ${hex(border)} on ${hex(outside)}`, el: describe(el) })
    }
  }
  out.push({ kind: '_stats', detail: String(textChecked), el: '' })

  // ---- Images ------------------------------------------------------------------------------------
  for (const img of document.querySelectorAll('img')) {
    if (!img.hasAttribute('alt')) out.push({ kind: 'img-no-alt', detail: img.getAttribute('src')?.slice(0, 60) || '', el: describe(img) })
  }

  // ---- Controls with no accessible name ------------------------------------------------------------
  for (const el of document.querySelectorAll('button, a[href], [role=button]')) {
    if (!visible(el)) continue
    if (!accessibleName(el)) out.push({ kind: 'no-accessible-name', detail: 'icon-only control with no label', el: describe(el) })
  }

  // ---- Form fields without a label -----------------------------------------------------------------
  for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea')) {
    if (!visible(el)) continue
    const byFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null
    const wrapped = el.closest('label')
    if (!byFor && !wrapped && !accessibleName(el)) {
      out.push({ kind: 'field-no-label', detail: el.placeholder ? `placeholder only: "${el.placeholder}"` : 'no label at all', el: describe(el) })
    }
  }

  // ---- Focus indicators are checked outside this function, with a real keyboard --------------------
  /*
   * Deliberately not done here, after three attempts that all reported the same 150-odd elements as
   * having no focus indicator when every one of them had a good one.
   *
   * Reading class names guessed. Reading stylesheets could not match Tailwind's escaped selectors.
   * Calling el.focus() and comparing styles failed for a subtler reason: Chrome paints the default
   * ring on :focus-visible, and a programmatic focus does not satisfy that heuristic, so the ring
   * never appeared during the measurement. Treating `outline-style: none` at rest as "removed" was
   * wrong too, since that is the resting state of every element.
   *
   * The only honest way to ask "can a keyboard user see where they are" is to press Tab and look,
   * which `tabFocusAudit` below does.
   */

  // ---- Heading order -------------------------------------------------------------------------------
  const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map((h) => Number(h.tagName[1]))
  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i] > levels[i - 1] + 1) out.push({ kind: 'heading-skip', detail: `h${levels[i - 1]} followed by h${levels[i]}`, el: `heading sequence ${levels.join(',')}` })
  }
  if (levels.length && levels[0] !== 1) out.push({ kind: 'heading-no-h1', detail: `page starts at h${levels[0]}`, el: `heading sequence ${levels.slice(0, 8).join(',')}` })

  // ---- Tabular data rendered without table semantics -------------------------------------------------
  // A grid of equal-column rows with a header row above it is a table to a sighted user but not to a
  // screen reader, which cannot associate a cell with its column.
  for (const el of document.querySelectorAll('div[class*="grid-cols"]')) {
    if (!visible(el)) continue
    const siblings = [...(el.parentElement?.children || [])].filter((c) => c !== el && /grid-cols/.test(c.getAttribute('class') || ''))
    // A grid holding form controls is a field layout, not a data table. Without this, a form that
    // puts Price and Stock side by side reads as a table with no headers, which it is not.
    const isFormLayout = el.querySelector('input, select, textarea, label') !== null || el.closest('form') !== null
    if (siblings.length >= 2 && !isFormLayout && !el.closest('table') && el.getAttribute('role') !== 'row') {
      const cols = (el.getAttribute('class') || '').match(/grid-cols-\[([^\]]+)\]|grid-cols-(\d+)/)
      out.push({ kind: 'table-without-semantics', detail: `repeating grid row (${cols ? cols[0] : 'grid'}), ${siblings.length + 1} rows, no table roles`, el: describe(el) })
      break
    }
  }

  return out
}

const browser = await chromium.launch()

/**
 * Walks the page with the Tab key, the way a keyboard user does, and reports any element that shows
 * no visible focus indicator when it receives focus. Real key presses, because Chrome only paints a
 * focus ring when it believes the keyboard is in use.
 */
async function tabFocusAudit(page, label, width, steps = 25) {
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
  const seen = new Set()
  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press('Tab')
    const r = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body || el === document.documentElement) return null
      const c = getComputedStyle(el)
      const ring = c.outlineStyle !== 'none' && c.outlineWidth !== '0px'
      const shadow = c.boxShadow !== 'none'
      const tag = el.tagName.toLowerCase()
      const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.')
      const text = (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 40).replace(/\s+/g, ' ')
      return { visible: ring || shadow, el: `${tag}${cls ? '.' + cls : ''}${text ? ` "${text}"` : ''}` }
    })
    if (!r || seen.has(r.el)) continue
    seen.add(r.el)
    if (!r.visible) findings.push({ screen: label, width, kind: 'focus-invisible', detail: 'no visible focus indicator when reached with the Tab key', el: r.el })
  }
}

async function audit(page, label, width, minTarget) {
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.waitForTimeout(400)
  const raw = await page.evaluate(AUDIT, minTarget)
  const stats = raw.find((f) => f.kind === '_stats')
  textElementsChecked += stats ? Number(stats.detail) : 0
  const found = raw.filter((f) => f.kind !== '_stats')
  await tabFocusAudit(page, label, width)
  screensChecked += 1
  const seen = new Set()
  for (const f of found) {
    const key = `${label}|${f.kind}|${f.el}`
    if (seen.has(key)) continue
    seen.add(key)
    findings.push({ screen: label, width, ...f })
  }
  const counts = found.reduce((a, f) => ({ ...a, [f.kind]: (a[f.kind] || 0) + 1 }), {})
  const summary = Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' ') || 'clean'
  console.log(`  ${String(width).padStart(4)}px ${label.padEnd(42)} ${summary}`)
}

// ---- Fixture ---------------------------------------------------------------------------------------
const ownerEmail = `e2e-a11y-${suffix}@example.com`
const reg = await api('POST', '/auth/register', {
  body: { email: ownerEmail, password, storeName: `E2E A11y ${suffix}`, storeSlug: `e2e-a11y-${suffix}`, currency: 'PKR' },
})
if (reg.status !== 201) {
  console.log('setup failed:', reg.status, JSON.stringify(reg.json))
  process.exit(1)
}
const token = reg.json.accessToken
const storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
// The shop wears a pale yellow, the hardest kind of merchant colour: white text on it measures 1.4:1.
// Storefronts deepen a colour like this until it passes (lib/brandTheme.ts), so every storefront
// screen below is also the test that they do.
const branding = await api('PATCH', `/stores/${storeId}/branding`, { token, body: { themeColor: '#FFD400' } })
if (branding.status !== 200) {
  console.log('setup failed: branding', branding.status, JSON.stringify(branding.json))
  process.exit(1)
}
for (const [title, price] of [['Ceramic Chai Cup', 450], ['Lawn Suit Three Piece', 2500], ['Handmade Khussa', 1800]]) {
  await api('POST', `/stores/${storeId}/products`, { token, body: { title, price, stock: 12, category: 'home and kitchen' } })
}

console.log('\nAuditing. Each line lists what was found on that screen.\n')

for (const [width, height] of [[375, 812], [1440, 900]]) {
  // reducedMotion: the landing page's scroll animations hold below-the-fold content at opacity 0
  // until it is scrolled to. Without this the audit skipped all of it as invisible, which is how
  // two contrast failures in the pricing and call-to-action sections went unreported.
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  const minTarget = 24 // WCAG 2.2 Target Size (Minimum) for web

  // Public screens
  for (const [label, url] of [
    ['landing page', WEB],
    ['shop directory', `${WEB}/shop`],
    ['merchant sign in', `${WEB}/login`],
    ['merchant sign up', `${WEB}/register`],
    ['terms of service', `${WEB}/terms`],
    ['privacy policy', `${WEB}/privacy`],
    ['storefront home', `${WEB}/store/${storeId}`],
    ['storefront catalog', `${WEB}/store/${storeId}/products`],
    ['storefront cart', `${WEB}/store/${storeId}/cart`],
    ['customer sign in', `${WEB}/store/${storeId}/account/login`],
  ]) {
    await page.goto(url).catch(() => undefined)
    await audit(page, label, width, minTarget)
  }

  // Merchant screens
  await page.goto(`${WEB}/login`)
  await page.getByLabel('Email').fill(ownerEmail)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL('**/admin/**')

  for (const [label, url] of [
    ['admin products', `${WEB}/admin/products`],
    ['admin dashboard', `${WEB}/admin/dashboard`],
    ['admin orders', `${WEB}/admin/orders`],
    ['admin settings', `${WEB}/admin/settings`],
    ['admin billing', `${WEB}/admin/billing`],
    ['admin payments', `${WEB}/admin/payments`],
    ['admin team', `${WEB}/admin/team`],
    ['admin marketing', `${WEB}/admin/marketing`],
    ['admin reviews', `${WEB}/admin/reviews`],
    ['admin voice notes', `${WEB}/admin/voice-notes`],
  ]) {
    await page.goto(url).catch(() => undefined)
    await audit(page, label, width, minTarget)
  }

  // The add-product form, which carries the AI panel
  await page.goto(`${WEB}/admin/products`)
  await page.getByRole('button', { name: 'Add product' }).first().click().catch(() => undefined)
  await audit(page, 'admin add product form', width, minTarget)

  // The register is used on a phone or tablet at a counter, so it is held to the touch number too.
  await page.goto(`${WEB}/pos/${storeId}`)
  const openShift = page.getByRole('heading', { name: 'Open the register' })
  if (await openShift.isVisible().catch(() => false)) {
    await page.getByLabel(/Starting cash/).fill('100')
    await page.getByRole('button', { name: 'Open shift' }).click()
    await page.getByLabel('Scan a SKU or search products').waitFor({ timeout: 15000 }).catch(() => undefined)
  }
  await audit(page, 'register (touch, 44px)', width, 44)

  await ctx.close()
}

await browser.close()

// ---- Report -------------------------------------------------------------------------------------------
const byKind = {}
for (const f of findings) (byKind[f.kind] ||= []).push(f)

console.log(`\n${'='.repeat(78)}\nFINDINGS: ${findings.length} across ${screensChecked} screen visits (${textElementsChecked} text elements measured for contrast)\n${'='.repeat(78)}`)
for (const [kind, list] of Object.entries(byKind).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${kind} (${list.length})`)
  const unique = new Map()
  for (const f of list) {
    const key = `${f.kind}|${f.el}|${f.detail}`
    if (!unique.has(key)) unique.set(key, { ...f, screens: new Set() })
    unique.get(key).screens.add(`${f.screen}@${f.width}`)
  }
  for (const f of [...unique.values()].slice(0, 12)) {
    console.log(`  - ${f.el}`)
    console.log(`      ${f.detail}`)
    console.log(`      on: ${[...f.screens].slice(0, 4).join(', ')}${f.screens.size > 4 ? ` (+${f.screens.size - 4} more)` : ''}`)
  }
  if (unique.size > 12) console.log(`  ... and ${unique.size - 12} more distinct`)
}

fs.writeFileSync(path.join(SHOTS, 'a11y-findings.json'), JSON.stringify(findings, null, 2))
console.log(`\nFull list written to e2e/shots/a11y-findings.json`)
process.exit(0)
