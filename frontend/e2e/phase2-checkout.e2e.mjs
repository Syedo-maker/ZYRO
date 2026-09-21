// Browser test for Phase 2 (cart, checkout, order confirmation, admin orders and shipping),
// run in real Chromium against the real frontend and backend. Stripe's hosted page is
// replaced by a stand-in and webhooks are delivered with a valid signature, exactly as
// Stripe would send them.
//
// Setup (one time):  npm install --no-save playwright && npx playwright install chromium
// Then, in three terminals (Postgres, MongoDB and Redis must be running):
//   backend:   npx tsx scripts/e2e-server.ts
//   frontend:  npm run dev
//   frontend:  node e2e/phase2-checkout.e2e.mjs
// It creates its own throwaway store (slug "e2e-...") and writes screenshots to e2e/shots/.
import { chromium } from 'playwright'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const API = 'http://localhost:5000/api/v1'
const WEB = 'http://localhost:5173'
const SECRET = 'whsec_e2e_secret'
const SHOTS = path.join(import.meta.dirname, 'shots')
fs.mkdirSync(SHOTS, { recursive: true })

let failures = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
  if (!ok) failures++
}
async function step(name, fn) {
  try {
    await fn()
  } catch (e) {
    failures++
    console.log(`FAIL  ${name}  (${String(e.message).split('\n')[0]})`)
  }
}

async function api(method, p, { token, body } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}
function sign(payload) {
  const t = Math.floor(Date.now() / 1000)
  return `t=${t},v1=${crypto.createHmac('sha256', SECRET).update(`${t}.${payload}`).digest('hex')}`
}
async function webhook(type, session) {
  const payload = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, object: 'event', type, data: { object: session } })
  const res = await fetch(`${API}/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sign(payload) }, body: payload })
  return res.json()
}
const paid = (id, cents, email, name) => ({
  id,
  object: 'checkout.session',
  payment_status: 'paid',
  amount_total: cents,
  currency: 'usd',
  payment_intent: `pi_${id}`,
  customer_details: { email, name },
  collected_information: {
    shipping_details: { name, address: { line1: '240 Baker Street', line2: null, city: 'Boston', state: 'MA', postal_code: '02101', country: 'US' } },
  },
})
const dollars = (text) => Math.round(parseFloat(text.replace(/[^0-9.]/g, '')) * 100)

const browser = await chromium.launch()
const consoleErrors = []
function watch(page, label) {
  // Browser-level network logs for the guest's silent-login 401 and the deliberate 409 are expected, not app errors.
  const expected = /Failed to load resource: the server responded with a status of (401|409)/
  page.on('console', (m) => m.type() === 'error' && !expected.test(m.text()) && consoleErrors.push(`[${label}] ${m.text()}`))
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror ${e.message}`))
}

// ---- Setup through the API ----
const suffix = Date.now().toString(36)
const email = `e2e-${suffix}@example.com`
const reg = await api('POST', '/auth/register', { body: { email, password: 'password123', storeName: 'E2E Shop', storeSlug: `e2e-${suffix}` } })
const stores = await api('GET', '/users/me/stores', { token: reg.json.accessToken })
const storeId = (Array.isArray(stores.json) ? stores.json : stores.json.data)[0].id
const tok = reg.json.accessToken
const mugId = (await api('POST', `/stores/${storeId}/products`, { token: tok, body: { title: 'Ceramic Mug', price: 12.5, stock: 5, category: 'kitchen' } })).json.id
const posterId = (await api('POST', `/stores/${storeId}/products`, { token: tok, body: { title: 'Art Poster', price: 20, stock: 1, category: 'art' } })).json.id
await fetch('http://localhost:5000/__e2e/set-tax', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId, rate: 10 }) })
const stockOf = async (id) => (await api('GET', `/stores/${storeId}/products/${id}`)).json.stock

// ---- Merchant: log in through the UI, create a shipping zone ----
const merchantCtx = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 } })
const admin = await merchantCtx.newPage()
watch(admin, 'admin')

await step('merchant login and empty orders page', async () => {
  await admin.goto(`${WEB}/login`)
  await admin.getByLabel('Email').fill(email)
  await admin.getByLabel('Password').fill('password123')
  await admin.getByRole('button', { name: 'Log in' }).click()
  await admin.waitForURL('**/admin/products')
  await admin.getByRole('link', { name: 'Orders' }).click()
  await admin.waitForURL('**/admin/orders')
  await admin.getByText('No orders yet').waitFor()
  check('admin: Orders nav is enabled and shows an empty state', true)
  await admin.getByText('No shipping zones yet').waitFor()
  check('admin: shipping zones panel shows its empty state', true)
})

await step('add a shipping zone in the UI', async () => {
  await admin.getByRole('button', { name: '+ Add zone' }).click()
  await admin.getByLabel('Zone name').fill('Standard')
  await admin.getByLabel('Region').fill('US')
  await admin.getByLabel('Rate').fill('5.5')
  await admin.getByRole('button', { name: 'Add', exact: true }).click()
  await admin.getByRole('cell', { name: 'Standard' }).waitFor()
  check('admin: the new zone appears with its formatted rate', await admin.getByRole('cell', { name: '$5.50' }).isVisible())
})

// ---- Shopper (guest) ----
const shopperCtx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } })
const shop = await shopperCtx.newPage()
watch(shop, 'shopper')
const card = (title) => shop.getByRole('listitem').filter({ hasText: title })
let sessionId1 = ''

await step('browse and add to cart', async () => {
  await shop.goto(`${WEB}/store/${storeId}`)
  await shop.getByRole('heading', { name: 'New arrivals' }).waitFor()
  await card('Art Poster').waitFor()
  check('shop: both products listed with formatted prices',(await card('Ceramic Mug').getByText('$12.50').isVisible()) && (await card('Art Poster').getByText('$20.00').isVisible()))
  await shop.screenshot({ path: path.join(SHOTS, '1-shop.png') })

  await card('Ceramic Mug').getByRole('button', { name: /Add to cart/ }).click()
  await card('Ceramic Mug').getByRole('button', { name: /Add to cart/ }).click()
  await shop.getByRole('link', { name: 'Cart, 2 items' }).waitFor()
  check('shop: header cart badge counts 2 items', true)
  await card('Art Poster').getByRole('button', { name: /Add to cart/ }).click()
  await shop.getByRole('link', { name: 'Cart, 3 items' }).waitFor()
  await card('Art Poster').getByRole('button', { name: /Add to cart/ }).click()
  await shop.getByRole('alert').waitFor()
  check('shop: adding more than the stock shows the server error, not a crash', /stock/i.test(await shop.getByRole('alert').textContent()))
})

await step('cart page', async () => {
  await shop.getByRole('link', { name: /^Cart/ }).click()
  await shop.getByRole('heading', { name: 'Your cart' }).waitFor()
  check('cart: guest cart survives navigation, subtotal $45.00', await shop.getByText('$45.00').first().isVisible())
  check('cart: increase is disabled at the stock limit (poster)', await shop.getByRole('button', { name: 'Increase quantity of Art Poster' }).isDisabled())
  check('cart: the discount code is entered at checkout, so the cart page has no code box', (await shop.getByLabel('Discount code').count()) === 0)
  await shop.getByRole('button', { name: 'Decrease quantity of Ceramic Mug' }).click()
  await shop.getByText('$32.50').first().waitFor()
  await shop.getByRole('button', { name: 'Increase quantity of Ceramic Mug' }).click()
  await shop.getByText('$45.00').first().waitFor()
  check('cart: quantity stepper updates the subtotal from the server', true)
  await shop.reload()
  await shop.getByText('$45.00').first().waitFor()
  check('cart: still there after a full page reload (guest session in localStorage)', true)
  await shop.screenshot({ path: path.join(SHOTS, '2-cart.png') })
})

await step('checkout page and Pay', async () => {
  await shop.getByRole('link', { name: 'Proceed to checkout' }).click()
  await shop.getByRole('heading', { name: 'Checkout' }).waitFor()
  check('checkout: shipping zone is listed and preselected', await shop.getByRole('radio', { name: /Standard/ }).isChecked())
  await shop.getByText('Pay $55.00').waitFor()
  check('checkout: server-priced total is 55.00 (45 + 5.50 shipping + 4.50 tax)', true)
  check('checkout: totals rows show shipping and tax', (await shop.getByText('$5.50').first().isVisible()) && (await shop.getByText('$4.50').first().isVisible()))
  await shop.screenshot({ path: path.join(SHOTS, '3-checkout.png') })
  await shop.getByRole('button', { name: /Pay \$55.00/ }).click()
  await shop.waitForURL('**/__fake-stripe/**')
  sessionId1 = shop.url().split('/').pop()
  check('checkout: Pay redirects to the (fake) Stripe hosted page', sessionId1.startsWith('cs_test_e2e_'))
})

await step('confirmation page waits for the webhook, then shows the order', async () => {
  await shop.goto(`${WEB}/store/${storeId}/checkout/success?session_id=${sessionId1}`)
  await shop.getByText('Confirming your payment').waitFor()
  check('confirmation: shows a waiting state while the webhook has not arrived yet', true)
  await shop.screenshot({ path: path.join(SHOTS, '4a-confirming.png') })
  await new Promise((r) => setTimeout(r, 2500))
  const out = await webhook('checkout.session.completed', paid(sessionId1, 5500, 'sam@example.com', 'Sam Shopper'))
  check('webhook: accepted and fulfilled', out.outcome === 'fulfilled', JSON.stringify(out))
  await shop.getByRole('heading', { name: 'Order confirmed' }).waitFor({ timeout: 15000 })
  check('confirmation: page updates by itself once the order exists', true)
  check('confirmation: shows order number, total and status', (await shop.getByText('#1').isVisible()) && (await shop.getByText('$55.00').first().isVisible()) && (await shop.getByText('Processing').isVisible()))
  check('confirmation: greets the customer by first name', await shop.getByText('Thanks, Sam.').isVisible())
  await shop.getByRole('link', { name: 'Cart, 0 items' }).waitFor()
  check('confirmation: header cart badge clears once the order consumed the cart', true)
  await shop.screenshot({ path: path.join(SHOTS, '4-confirmed.png') })
  await shop.goto(`${WEB}/store/${storeId}/cart`)
  await shop.getByRole('heading', { name: 'Your cart is empty' }).waitFor()
  check('cart: emptied once the order exists', true)
})

// ---- Merchant: manage the order ----
await step('order appears in the admin list', async () => {
  await admin.reload()
  await admin.getByRole('button', { name: '#1' }).waitFor()
  check('admin: order #1 listed, customer name, Online, Processing', (await admin.getByRole('row', { name: /#1.*Sam Shopper.*Online.*Processing/ }).count()) === 1)
  check('admin: tab counts reflect the data', (await admin.getByRole('tab', { name: 'All (1)' }).isVisible()) && (await admin.getByRole('tab', { name: 'Processing (1)' }).isVisible()))
  await admin.getByRole('button', { name: '#1' }).click()
})
const panel = () => admin.getByRole('complementary', { name: 'Order 1 details' })

await step('order detail, shipping address and shipment', async () => {
  await panel().waitFor()
  check('detail: shipping address collected by Stripe is shown', (await panel().getByText('240 Baker Street').isVisible()) && (await panel().getByText('Boston, MA, 02101').isVisible()))
  check('detail: payment method reads "Stripe", not "stripe"', await panel().getByText('Paid by Stripe $55.00').isVisible())
  check('detail: action buttons stay on one line each', (await panel().getByRole('button', { name: 'Mark fulfilled' }).boundingBox()).height < 48)
  check('detail: line items and totals',(await panel().getByText(/Ceramic Mug/).isVisible()) && (await panel().getByText('$4.50').isVisible()))
  await admin.screenshot({ path: path.join(SHOTS, '5-admin-order.png') })
  await panel().getByLabel('Carrier').fill('DHL')
  await panel().getByLabel('Tracking number').fill('T-100')
  await panel().getByRole('button', { name: 'Mark shipped' }).click()
  await panel().getByText('Shipped', { exact: true }).waitFor()
  check('shipment: marking shipped moves the order to Fulfilled', await panel().getByText('Fulfilled').first().isVisible())
  check('shipment: list row updated too', (await admin.getByRole('row', { name: /#1.*Fulfilled/ }).count()) === 1)
  await panel().getByRole('button', { name: 'Mark delivered' }).click()
  await panel().getByText('Delivered', { exact: true }).waitFor()
  check('shipment: delivered', true)
})

await step('refund a shipped order', async () => {
  await panel().getByRole('button', { name: 'Refund', exact: true }).click()
  const dialog = admin.getByRole('dialog')
  await dialog.waitFor()
  check('refund dialog: opens, restock is off by default for a shipped order', !(await dialog.getByLabel('Put the items back in stock').isChecked()))
  await admin.screenshot({ path: path.join(SHOTS, '6-refund-dialog.png') })
  await dialog.getByLabel('Reason (optional)').fill('Customer changed mind')
  await dialog.getByRole('button', { name: 'Refund order' }).click()
  await panel().getByText(/Refunded .*Customer changed mind/).waitFor()
  check('refund: order shows as Refunded with the reason and "not returned to stock"', await panel().getByText(/Items not returned to stock/).isVisible())
  await admin.getByRole('tab', { name: 'Refunded (1)' }).waitFor()
  check('refund: Refunded tab count updates', true)
  check('refund: stock was not put back (mug 5 - 2 = 3, poster 1 - 1 = 0)', (await stockOf(mugId)) === 3 && (await stockOf(posterId)) === 0)
})

// ---- Sold out between checkout and payment ----
await step('an item sells out while the shopper is paying', async () => {
  await shop.goto(`${WEB}/store/${storeId}`)
  const add = card('Ceramic Mug').getByRole('button', { name: /Add to cart/ })
  for (let i = 0; i < 3; i++) {
    await add.click()
    await shop.getByRole('link', { name: `Cart, ${i + 1} ${i === 0 ? 'item' : 'items'}` }).waitFor()
  }
  await shop.getByRole('link', { name: /^Cart/ }).click()
  await shop.getByRole('link', { name: 'Proceed to checkout' }).click()
  await shop.getByRole('button', { name: /^Pay \$/ }).waitFor()
  const cents = dollars(await shop.getByRole('button', { name: /^Pay \$/ }).textContent())
  await shop.getByRole('button', { name: /^Pay \$/ }).click()
  await shop.waitForURL('**/__fake-stripe/**')
  const sid = shop.url().split('/').pop()
  await api('PUT', `/stores/${storeId}/products/${mugId}`, { token: tok, body: { title: 'Ceramic Mug', price: 12.5, stock: 0, category: 'kitchen' } })
  const out = await webhook('checkout.session.completed', paid(sid, cents, 'sam@example.com', 'Sam Shopper'))
  check('webhook: refunded automatically because the stock ran out', out.outcome === 'refunded-out-of-stock', JSON.stringify(out))
  await shop.goto(`${WEB}/store/${storeId}/checkout/success?session_id=${sid}`)
  await shop.getByRole('heading', { name: 'Sorry, an item sold out' }).waitFor()
  check('confirmation: tells the shopper they were refunded', await shop.getByText(/refunded in full/).isVisible())
  await shop.screenshot({ path: path.join(SHOTS, '7-soldout.png') })
})

// ---- Cancel flow, keyboard dismissal ----
await step('cancel a paid order (Escape closes the dialog first)', async () => {
  await api('PUT', `/stores/${storeId}/products/${mugId}`, { token: tok, body: { title: 'Ceramic Mug', price: 12.5, stock: 4, category: 'kitchen' } })
  // The sold-out checkout left 3 mugs in the shopper's cart (correct: the cart is kept). Clear it in the UI first.
  await shop.goto(`${WEB}/store/${storeId}/cart`)
  await shop.getByRole('button', { name: 'Remove Ceramic Mug from cart' }).click()
  await shop.getByRole('heading', { name: 'Your cart is empty' }).waitFor()
  await shop.goto(`${WEB}/store/${storeId}`)
  await card('Ceramic Mug').getByRole('button', { name: /Add to cart/ }).click()
  await shop.getByRole('link', { name: 'Cart, 1 item' }).waitFor()
  await shop.getByRole('link', { name: /^Cart/ }).click()
  await shop.getByRole('link', { name: 'Proceed to checkout' }).click()
  await shop.getByRole('button', { name: /^Pay \$/ }).waitFor()
  const cents = dollars(await shop.getByRole('button', { name: /^Pay \$/ }).textContent())
  await shop.getByRole('button', { name: /^Pay \$/ }).click()
  await shop.waitForURL('**/__fake-stripe/**')
  const sid = shop.url().split('/').pop()
  await webhook('checkout.session.completed', paid(sid, cents, 'sam@example.com', 'Sam Shopper'))

  await admin.reload()
  await admin.getByRole('button', { name: '#2' }).click()
  const p2 = admin.getByRole('complementary', { name: 'Order 2 details' })
  await p2.getByRole('button', { name: 'Cancel order' }).click()
  await admin.getByRole('dialog').waitFor()
  await admin.keyboard.press('Escape')
  await admin.getByRole('dialog').waitFor({ state: 'hidden' })
  check('cancel: Escape closes the dialog and the order is untouched', await p2.getByText('Processing').first().isVisible())
  await p2.getByRole('button', { name: 'Cancel order' }).click()
  await admin.getByRole('button', { name: 'Cancel and refund' }).click()
  await p2.getByText('Cancelled').first().waitFor()
  check('cancel: order is Cancelled', true)
  check('cancel: the mug is back in stock (0 + 4 - 1 sold + 1 restocked = 4)', (await stockOf(mugId)) === 4)
})

await step('filters and search', async () => {
  await admin.getByPlaceholder('Search by order number').fill('1')
  await admin.getByRole('button', { name: '#2' }).waitFor({ state: 'detached' })
  check('search: order number 1 finds only order 1', (await admin.getByRole('button', { name: '#1' }).count()) === 1)
  await admin.getByPlaceholder('Search by order number').fill('')
  await admin.getByLabel('Sales channel').selectOption('pos')
  await admin.getByText('No orders match these filters.').waitFor()
  check('filter: In-store channel shows a filtered empty state (no POS orders yet)', true)
  await admin.getByLabel('Sales channel').selectOption('')
  await admin.getByRole('tab', { name: /Cancelled/ }).click()
  await admin.getByRole('button', { name: '#2' }).waitFor()
  check('filter: Cancelled tab lists only the cancelled order', (await admin.getByRole('button', { name: '#1' }).count()) === 0)
})

// ---- Keyboard-only shopping, mobile widths ----
await step('keyboard: add to cart without a mouse', async () => {
  const kb = await shopperCtx.newPage()
  watch(kb, 'keyboard')
  await kb.goto(`${WEB}/store/${storeId}`)
  await kb.getByRole('button', { name: /Add to cart/ }).first().waitFor()
  for (let i = 0; i < 40; i++) {
    await kb.keyboard.press('Tab')
    const name = await kb.evaluate(() => document.activeElement?.textContent ?? '')
    if (/Add to cart/.test(name)) break
  }
  const focused = await kb.evaluate(() => document.activeElement?.textContent ?? '')
  check('keyboard: Tab reaches an Add to cart button', /Add to cart/.test(focused), focused)
  await kb.keyboard.press('Enter')
  await kb.getByRole('status').filter({ hasText: 'added to your cart' }).waitFor()
  check('keyboard: Enter adds the item and announces it (role=status)', true)
  await kb.close()
})

await step('mobile 320px: no horizontal scroll', async () => {
  const mob = await browser.newContext({ locale: 'en-US', viewport: { width: 320, height: 700 } })
  const m = await mob.newPage()
  watch(m, 'mobile')
  await m.goto(`${WEB}/store/${storeId}`)
  await m.getByRole('heading', { name: 'New arrivals' }).waitFor()
  const wide = async () => m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  check('mobile: shop page fits 320px', !(await wide()))
  await m.getByRole('button', { name: /Add to cart/ }).first().click()
  await m.getByRole('link', { name: /^Cart, 1 item/ }).waitFor()
  await m.getByRole('link', { name: /^Cart/ }).click()
  await m.getByRole('heading', { name: 'Your cart' }).waitFor()
  check('mobile: cart page fits 320px', !(await wide()))
  await m.screenshot({ path: path.join(SHOTS, '8-mobile-cart.png') })
  await m.getByRole('link', { name: 'Proceed to checkout' }).click()
  await m.getByRole('heading', { name: 'Checkout' }).waitFor()
  check('mobile: checkout page fits 320px', !(await wide()))
  await m.screenshot({ path: path.join(SHOTS, '9-mobile-checkout.png') })
  await mob.close()
})

check('no console errors or uncaught exceptions on any page', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
await browser.close()
console.log(failures === 0 ? '\nAll browser checks passed.' : `\n${failures} browser check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
