// Photographs every screen at a phone width and a desktop width, so a visual change can be
// reviewed as a real before-and-after rather than described.
//
//   node e2e/visual-capture.e2e.mjs baseline     before a change
//   node e2e/visual-capture.e2e.mjs after        after it
//   node e2e/visual-capture.e2e.mjs compare      builds e2e/shots/visual/compare.html, side by side
//
// The same fixture shop is used for every run (found again by its fixed slug), so the two sets show
// the same data and differ only in what changed. Screenshots live under e2e/shots/, which is
// gitignored: they are review material, not source.
//
// Setup: backend (npm run dev or npx tsx scripts/e2e-server.ts) and Redis, and `npm run dev` in the
// frontend.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
const ROOT = path.join(import.meta.dirname, 'shots', 'visual')
const mode = process.argv[2] ?? 'baseline'

if (!['baseline', 'after', 'compare'].includes(mode)) {
  console.log('usage: node e2e/visual-capture.e2e.mjs baseline|after|compare')
  process.exit(1)
}

const WIDTHS = [
  ['phone', 375, 812],
  ['desktop', 1440, 900],
]

// ---- compare: no browser needed ------------------------------------------------------------------
if (mode === 'compare') {
  const before = path.join(ROOT, 'baseline')
  const after = path.join(ROOT, 'after')
  if (!fs.existsSync(before) || !fs.existsSync(after)) {
    console.log('Run "baseline" and "after" first.')
    process.exit(1)
  }
  const shots = fs.readdirSync(before).filter((f) => f.endsWith('.png') && fs.existsSync(path.join(after, f))).sort()
  const rows = shots
    .map(
      (f) => `<section><h2>${f.replace('.png', '').replace(/-/g, ' ')}</h2><div class="pair">
  <figure><figcaption>Before</figcaption><img loading="lazy" src="baseline/${f}" alt="Before: ${f}"></figure>
  <figure><figcaption>After</figcaption><img loading="lazy" src="after/${f}" alt="After: ${f}"></figure>
</div></section>`
    )
    .join('\n')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZYRO visual comparison</title>
<style>body{font:14px system-ui,sans-serif;margin:0;padding:24px;background:#f4f3ee;color:#0b3b33}h1{margin:0 0 4px}
p{margin:0 0 24px}section{margin:0 0 40px}h2{font-size:15px;margin:0 0 8px;text-transform:capitalize}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0}figcaption{font-weight:700;margin-bottom:6px}
img{width:100%;border:1px solid #0b3b3322;border-radius:8px;background:#fff}</style></head>
<body><h1>ZYRO visual comparison</h1><p>${shots.length} screens, before and after.</p>${rows}</body></html>`
  fs.writeFileSync(path.join(ROOT, 'compare.html'), html)
  console.log(`Wrote ${path.join(ROOT, 'compare.html')} with ${shots.length} pairs.`)
  process.exit(0)
}

// ---- capture -------------------------------------------------------------------------------------
const OUT = path.join(ROOT, mode)
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

async function api(method, p, { token, body } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text()
  return { status: res.status, json: t ? JSON.parse(t) : null }
}

// A fixed fixture, so "after" photographs the same shop "baseline" did.
const email = 'e2e-visual-fixture@example.com'
const password = 'password123'
let token
const login = await api('POST', '/auth/login', { body: { email, password } })
if (login.status === 200) {
  token = login.json.accessToken
} else {
  const reg = await api('POST', '/auth/register', {
    body: { email, password, storeName: 'Visual Fixture Shop', storeSlug: 'e2e-visual-fixture', currency: 'PKR' },
  })
  if (reg.status !== 201) {
    console.log('fixture setup failed:', reg.status, JSON.stringify(reg.json))
    process.exit(1)
  }
  token = reg.json.accessToken
}
const storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
const existing = (await api('GET', `/stores/${storeId}/products?limit=5`)).json?.data ?? []
if (existing.length < 3) {
  for (const [title, price, category] of [
    ['Ceramic Chai Cup', 450, 'home and kitchen'],
    ['Lawn Suit Three Piece', 2500, 'clothing'],
    ['Handmade Khussa', 1800, 'footwear'],
  ]) {
    await api('POST', `/stores/${storeId}/products`, { token, body: { title, price, stock: 12, category } })
  }
}
const productId = (await api('GET', `/stores/${storeId}/products?limit=1`)).json.data[0].id

const PUBLIC = [
  ['landing', WEB],
  ['shop-directory', `${WEB}/shop`],
  ['merchant-sign-in', `${WEB}/login`],
  ['merchant-sign-up', `${WEB}/register`],
  ['storefront-home', `${WEB}/store/${storeId}`],
  ['storefront-catalog', `${WEB}/store/${storeId}/products`],
  ['storefront-product', `${WEB}/store/${storeId}/products/${productId}`],
  ['storefront-cart', `${WEB}/store/${storeId}/cart`],
  ['customer-sign-in', `${WEB}/store/${storeId}/account/login`],
]
const MERCHANT = [
  ['admin-products', `${WEB}/admin/products`],
  ['admin-dashboard', `${WEB}/admin/dashboard`],
  ['admin-orders', `${WEB}/admin/orders`],
  ['admin-settings', `${WEB}/admin/settings`],
  ['admin-billing', `${WEB}/admin/billing`],
  ['admin-payments', `${WEB}/admin/payments`],
  ['admin-team', `${WEB}/admin/team`],
  ['admin-marketing', `${WEB}/admin/marketing`],
  ['admin-reviews', `${WEB}/admin/reviews`],
  ['admin-voice-notes', `${WEB}/admin/voice-notes`],
]

const browser = await chromium.launch()
let count = 0
async function shoot(page, name, width) {
  await page.waitForLoadState('networkidle').catch(() => undefined)
  // Let scroll-reveal animations finish, so nothing is photographed half-faded.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 60))
    }
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(700)
  await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`), fullPage: true })
  count += 1
}

for (const [label, width, height] of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
  const page = await ctx.newPage()

  for (const [name, url] of PUBLIC) {
    await page.goto(url).catch(() => undefined)
    await shoot(page, name, label)
  }

  await page.goto(`${WEB}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL('**/admin/**')

  for (const [name, url] of MERCHANT) {
    await page.goto(url).catch(() => undefined)
    await shoot(page, name, label)
  }

  await page.goto(`${WEB}/admin/products`)
  await page.getByRole('button', { name: 'Add product' }).first().click().catch(() => undefined)
  await shoot(page, 'admin-add-product', label)

  await page.goto(`${WEB}/pos/${storeId}`)
  const openShift = page.getByRole('heading', { name: 'Open the register' })
  if (await openShift.isVisible().catch(() => false)) await shoot(page, 'register-open-shift', label)
  if (await openShift.isVisible().catch(() => false)) {
    await page.getByLabel(/Starting cash/).fill('100')
    await page.getByRole('button', { name: 'Open shift' }).click()
    await page.getByLabel('Scan a SKU or search products').waitFor({ timeout: 15000 }).catch(() => undefined)
  }
  await shoot(page, 'register-selling', label)

  await ctx.close()
}

await browser.close()
console.log(`Captured ${count} screenshots into ${OUT}`)
process.exit(0)
