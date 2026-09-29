// Phone and tablet check of every screen: storefront, admin and point of sale. At 375 px (a small
// phone) and 768 px (a tablet) each page must load, show its heading, never scroll sideways (wide
// tables may scroll inside their own box, the page itself may not) and log no console errors.
// When a page does overflow, the elements sticking out are named, so the fix is findable.
//
// Setup and run: backend e2e server (npx tsx scripts/e2e-server.ts) and Redis, and `npm run dev`
// in the frontend, then: node e2e/responsive.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (slugs and emails use the e2e- prefix).
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
const SHOTS = path.join(import.meta.dirname, 'shots', 'responsive')
fs.mkdirSync(SHOTS, { recursive: true })
let failures = 0
const check = (n, ok, x = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`)
  if (!ok) failures++
}
const suffix = Date.now().toString(36)
const password = 'password123'

async function api(method, p, { token, body } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text()
  return { status: res.status, json: t ? JSON.parse(t) : null }
}

// ---- A store with enough in it that every page has real content ----
const ownerEmail = `e2e-resp-owner-${suffix}@example.com`
const reg = await api('POST', '/auth/register', { body: { email: ownerEmail, password, storeName: `Responsive Shop ${suffix}`, storeSlug: `e2e-resp-${suffix}` } })
const token = reg.json.accessToken
const storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
const products = []
for (const [title, price, stock] of [['Ceramic Coffee Mug With A Long Name', 12.5, 10], ['Espresso Cup', 9, 4], ['Desk Lamp', 30, 0]]) {
  products.push((await api('POST', `/stores/${storeId}/products`, { token, body: { title, price, stock, category: 'kitchen', description: 'A good product for testing layouts on small screens.' } })).json.id)
}
await api('POST', `/stores/${storeId}/discount-codes`, { token, body: { code: 'WELCOME10', type: 'percentage', value: 10 } })
// The platform page is only for super admins: make this owner one for the run (removed at the end).
const backend = path.resolve(import.meta.dirname, '../../backend')
execSync(`npx tsx scripts/make-super-admin.ts ${ownerEmail}`, { cwd: backend, stdio: 'ignore' })

const browser = await chromium.launch()
const errors = []
const expected = /Failed to load resource: the server responded with a status of (400|401|402|403|404|409)/

async function session(label, width, height) {
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500 })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && !expected.test(m.text()) && errors.push(`${label}: ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`${label} pageerror ${e.message}`))
  return { ctx, page }
}

/** How far the page scrolls sideways, and which visible elements stick out past the right edge. */
async function overflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    const extra = doc.scrollWidth - doc.clientWidth
    const offenders = []
    if (extra > 0) {
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.right <= doc.clientWidth + 1) continue
        // Skip anything inside a box that scrolls on its own (a wide table in an overflow-x-auto wrapper).
        let p = el.parentElement
        let contained = false
        while (p && p !== document.body) {
          const s = getComputedStyle(p)
          if (/(auto|scroll|hidden)/.test(s.overflowX) && p.getBoundingClientRect().right <= doc.clientWidth + 1) {
            contained = true
            break
          }
          p = p.parentElement
        }
        if (contained) continue
        const id = el.id ? `#${el.id}` : ''
        const cls = typeof el.className === 'string' ? '.' + el.className.split(/\s+/).slice(0, 3).join('.') : ''
        offenders.push(`${el.tagName.toLowerCase()}${id}${cls} (right ${Math.round(r.right)}px)`)
        if (offenders.length >= 4) break
      }
    }
    return { extra, offenders }
  })
}

async function login(page, email, pw = password) {
  await page.goto(`${WEB}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(pw)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL('**/admin/**')
}

async function visit(page, label, width, url, ready) {
  try {
    if (url) await page.goto(url)
    await ready()
    await page.waitForLoadState('networkidle').catch(() => undefined)
    await page.waitForTimeout(300)
    const o = await overflow(page)
    check(`${width}px ${label}: no sideways scrolling`, o.extra <= 0, o.extra > 0 ? `page is ${o.extra}px too wide; sticking out: ${o.offenders.join(', ') || 'unknown'}` : '')
    await page.screenshot({ path: path.join(SHOTS, `${width}-${label.replace(/\W+/g, '-')}.png`), fullPage: true })
  } catch (e) {
    check(`${width}px ${label}: loads`, false, String(e.message).split('\n')[0])
  }
}

const S = `${WEB}/store/${storeId}`
const heading = (page, name) => () => page.getByRole('heading', { name, exact: false }).first().waitFor()
const h1 = (page) => () => page.getByRole('heading', { level: 1 }).first().waitFor()

for (const [width, height] of [[375, 740], [768, 1024]]) {
  // ---- Storefront, as a shopper ----
  const shop = await session(`shop-${width}`, width, height)
  const sp = shop.page
  await visit(sp, 'storefront home', width, S, h1(sp))
  await visit(sp, 'catalog', width, `${S}/products`, h1(sp))
  await visit(sp, 'product page', width, `${S}/products/${products[0]}`, heading(sp, 'Ceramic Coffee Mug'))
  await sp.getByRole('button', { name: 'Add to cart' }).first().click()
  await sp.getByText(/added to your cart/).waitFor()
  await visit(sp, 'cart', width, `${S}/cart`, h1(sp))
  await visit(sp, 'checkout', width, `${S}/checkout`, h1(sp))
  await visit(sp, 'customer sign in', width, `${S}/account/login`, h1(sp))
  await visit(sp, 'customer sign up', width, `${S}/account/register`, h1(sp))
  await sp.goto(S)
  await sp.getByRole('button', { name: 'Open shopping assistant' }).click()
  await visit(sp, 'shopping assistant open', width, null, () => sp.getByRole('dialog', { name: 'Shopping assistant' }).waitFor())
  await shop.ctx.close()

  // ---- Merchant sign in and admin ----
  const adm = await session(`admin-${width}`, width, height)
  const ap = adm.page
  await visit(ap, 'merchant sign in', width, `${WEB}/login`, h1(ap))
  await visit(ap, 'merchant sign up', width, `${WEB}/register`, h1(ap))
  await login(ap, ownerEmail)
  await visit(ap, 'admin products', width, `${WEB}/admin/products`, h1(ap))
  await ap.getByRole('button', { name: `Edit Ceramic Coffee Mug With A Long Name` }).click()
  await visit(ap, 'admin product form with AI tools', width, null, () => ap.getByRole('heading', { name: /^Edit Ceramic/ }).waitFor())
  await visit(ap, 'admin dashboard', width, `${WEB}/admin/dashboard`, h1(ap))
  await visit(ap, 'admin orders', width, `${WEB}/admin/orders`, h1(ap))
  await visit(ap, 'admin team', width, `${WEB}/admin/team`, h1(ap))
  await visit(ap, 'admin reviews', width, `${WEB}/admin/reviews`, h1(ap))
  await visit(ap, 'admin marketing', width, `${WEB}/admin/marketing`, h1(ap))
  await visit(ap, 'admin plan and billing', width, `${WEB}/admin/billing`, h1(ap))
  await visit(ap, 'admin platform', width, `${WEB}/admin/platform`, () => ap.getByRole('region', { name: 'Stores' }).waitFor())

  // ---- Point of sale, as the owner ----
  // The first pass opens a shift; on the second the shift is still open and the register shows at once.
  const openScreen = ap.getByRole('heading', { name: 'Open the register' })
  await visit(ap, 'register: open a shift', width, `${WEB}/pos/${storeId}`, () => openScreen.or(ap.getByRole('region', { name: 'Products' })).first().waitFor())
  if (await openScreen.isVisible()) {
    await ap.getByLabel(/Starting cash/).fill('100')
    await ap.getByRole('button', { name: 'Open shift' }).click()
  }
  await visit(ap, 'register: selling', width, null, () => ap.getByRole('region', { name: 'Products' }).waitFor())
  await visit(ap, 'register: history', width, `${WEB}/pos/${storeId}/history`, h1(ap))
  await visit(ap, 'register: daily summary', width, `${WEB}/pos/${storeId}/summary`, h1(ap))
  await adm.ctx.close()

  // The register's own sign-in page, seen signed out (a signed-in person is sent straight on).
  const pos = await session(`pos-${width}`, width, height)
  await visit(pos.page, 'register: sign in', width, `${WEB}/pos/login`, h1(pos.page))
  await pos.ctx.close()
}

execSync(`npx tsx scripts/make-super-admin.ts ${ownerEmail} --remove`, { cwd: backend, stdio: 'ignore' })
console.log(errors.length === 0 ? 'PASS  no console errors on any screen' : `FAIL  console errors:\n${errors.join('\n')}`)
if (errors.length) failures++
await browser.close()
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
