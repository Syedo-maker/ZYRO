// Real end-to-end Stripe test: Stripe's real hosted payment page, a real test card, real
// webhooks delivered by the Stripe CLI, and real refunds. Nothing is faked. It proves:
// payment, webhook to order, address and tax, a declined card, a merchant refund, and the
// automatic refund when an item sells out while the shopper is paying.
//
// Needs (see documentation/Stripe_Setup_And_Verification.md):
//   - STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in backend/.env (a Stripe test sandbox)
//   - the real backend:   cd backend;  npm run dev
//   - the frontend:       cd frontend; npm run dev
//   - the forwarder:      npx --yes @stripe/cli listen --forward-to localhost:5000/api/v1/webhooks/stripe
//   - Playwright:         cd frontend; npm install --no-save playwright
// Then:  cd frontend;  node e2e/stripe-real.e2e.mjs      (afterwards: cleanup-test-data.ts in backend)
// Uses Stripe TEST mode only; it refuses to run against a live key.
import { chromium } from 'playwright'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const BACKEND = path.resolve(here, '../../backend')
const require = createRequire(import.meta.url)
const Stripe = require(path.join(BACKEND, 'node_modules/stripe'))
const envText = fs.readFileSync(path.join(BACKEND, '.env'), 'utf8')
const secretKey = envText.match(/^STRIPE_SECRET_KEY="?([^"\r\n]+)"?/m)?.[1]
if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not set in backend/.env')
if (/_live_/.test(secretKey)) throw new Error('Refusing to run against a LIVE Stripe key; use a test sandbox')
const stripe = new Stripe(secretKey)

const API = 'http://localhost:5000/api/v1'
const WEB = 'http://localhost:5173'
const SHOTS = path.join(here, 'shots')
fs.mkdirSync(SHOTS, { recursive: true })

let failures = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
  if (!ok) failures++
}
async function api(method, p, { token, body } = {}) {
  const res = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, ms = 30000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await sleep(1000)
  }
  return null
}

// ---- setup: a real store with a product, a shipping rate and 10% tax ----
const s = Date.now().toString(36)
const reg = await api('POST', '/auth/register', { body: { email: `stripe-real-${s}@example.com`, password: 'password123', storeName: 'Real Stripe Shop', storeSlug: `e2e-real-${s}` } })
const stores = await api('GET', '/users/me/stores', { token: reg.json.accessToken })
const storeId = (Array.isArray(stores.json) ? stores.json : stores.json.data)[0].id
const tok = reg.json.accessToken
const mug = (await api('POST', `/stores/${storeId}/products`, { token: tok, body: { title: 'Ceramic Mug', price: 12.5, stock: 6, category: 'kitchen' } })).json
await api('POST', `/stores/${storeId}/shipping-zones`, { token: tok, body: { name: 'Standard', region: 'US', rateAmount: 5.5 } })
execFileSync('npx.cmd', ['tsx', 'scripts/set-store-tax.ts', storeId, '10'], { cwd: BACKEND, shell: true, stdio: 'ignore' })
const stockOf = async () => (await api('GET', `/stores/${storeId}/products/${mug.id}`)).json.stock

const browser = await chromium.launch()
const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 1000 } })
const page = await ctx.newPage()

async function buyOnStripe({ card = '4242424242424242', qty = 2, beforePay } = {}) {
  await page.goto(`${WEB}/store/${storeId}`)
  const add = page.getByRole('listitem').filter({ hasText: 'Ceramic Mug' }).getByRole('button', { name: /Add to cart/ })
  await add.waitFor()
  for (let i = 1; i <= qty; i++) {
    await add.click()
    await page.getByRole('link', { name: `Cart, ${i} ${i === 1 ? 'item' : 'items'}` }).waitFor()
  }
  await page.getByRole('link', { name: /^Cart/ }).click()
  await page.getByRole('link', { name: 'Proceed to checkout' }).click()
  await page.getByRole('button', { name: /^Pay \$/ }).waitFor()
  const total = (await page.getByRole('button', { name: /^Pay \$/ }).textContent()).trim()
  // The connection to Stripe's site occasionally resets from this machine (seen as
  // net::ERR_CONNECTION_RESET before their page loads), so retry the redirect a few times.
  const checkoutPage = page.url()
  for (let attempt = 1; ; attempt++) {
    await page.getByRole('button', { name: /^Pay \$/ }).click()
    try {
      await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 })
      break
    } catch (e) {
      if (attempt >= 3) throw e
      console.log(`  (redirect to Stripe failed: ${String(e.message).split('\n')[0]}; retrying ${attempt}/2)`)
      await page.goto(checkoutPage)
      await page.getByRole('button', { name: /^Pay \$/ }).waitFor()
    }
  }
  const sessionId = page.url().match(/cs_test_[A-Za-z0-9]+/)[0]
  await page.locator('#email').waitFor({ timeout: 30000 })
  if (beforePay) await beforePay()

  await page.locator('#email').fill('shopper@example.com')
  await page.locator('#shippingName').fill('Sam Shopper')
  await page.locator('#shippingCountry').selectOption('US')
  await page.locator('#shippingAddressLine1').fill('354 Oyster Point Blvd')
  await page.locator('#shippingLocality').fill('South San Francisco')
  const state = page.locator('#shippingAdministrativeArea')
  if (await state.count()) await state.selectOption('CA').catch(() => undefined)
  await page.locator('#shippingPostalCode').fill('94080')
  // Stripe lists the payment methods it offers for this buyer; the card fields appear after choosing Card.
  await page.locator('input[type="radio"]').first().check({ force: true, timeout: 10000 })
  await page.locator('#cardNumber').waitFor({ timeout: 15000 })
  await page.locator('#cardNumber').pressSequentially(card, { delay: 30 })
  await page.locator('#cardExpiry').pressSequentially('1234', { delay: 30 })
  await page.locator('#cardCvc').pressSequentially('123', { delay: 30 })
  await page.screenshot({ path: path.join(SHOTS, 'stripe-2-filled.png') })
  await page.getByTestId('hosted-payment-submit-button').click()
  return { sessionId, total }
}

// ================= 1. a successful payment =================
let first
try {
  first = await buyOnStripe()
  await page.waitForURL(new RegExp(`${WEB.replace(/\./g, '\\.')}/store/.*checkout/success`), { timeout: 60000 })
  check('pay: Stripe accepted the test card and redirected back to the storefront', true, first.sessionId.slice(0, 16) + '...')
  await page.getByRole('heading', { name: 'Order confirmed' }).waitFor({ timeout: 40000 })
  check('webhook: Stripe delivered the real event and the order was created (confirmation page shows it)', true)
  await page.screenshot({ path: path.join(SHOTS, 'stripe-3-confirmed.png') })
  check('confirmation: shows order #1, the total the shopper saw, and the Stripe email', (await page.getByText('#1').isVisible()) && (await page.getByText(first.total.replace('Pay ', '')).first().isVisible()) && (await page.getByText('shopper@example.com').isVisible()))
} catch (e) {
  failures++
  console.log(`FAIL  successful payment flow  (${String(e.message).split('\n')[0]})  url=${page.url()}`)
  await page.screenshot({ path: path.join(SHOTS, 'stripe-failure-1.png') }).catch(() => undefined)
}

const orders = await api('GET', `/stores/${storeId}/orders`, { token: tok })
const order = orders.json?.data?.[0]
check('order: exists in the merchant list as an online, paid order', !!order && order.channel === 'online' && order.status === 'paid', order ? `#${order.orderNumber} ${order.status}` : 'none')
check('order: total 33.00 = 25.00 items + 5.50 shipping + 2.50 tax, exactly as priced', order && order.subtotal === 25 && order.shippingAmount === 5.5 && order.taxAmount === 2.5 && order.total === 33)
check('order: the shipping address entered on Stripe was saved', order?.shippingName === 'Sam Shopper' && order?.shippingAddress?.line1 === '354 Oyster Point Blvd' && order?.shippingAddress?.city === 'South San Francisco' && order?.shippingAddress?.postalCode === '94080' && order?.shippingAddress?.country === 'US', JSON.stringify(order?.shippingAddress))
check('order: customer email came from Stripe', order?.customer?.email === 'shopper@example.com' || order?.guestEmail === 'shopper@example.com')
check('stock: 2 mugs deducted (6 to 4)', (await stockOf()) === 4)

// what Stripe itself recorded
const sess = await stripe.checkout.sessions.retrieve(first.sessionId)
check('stripe: the session is paid and complete on Stripe\'s side', sess.payment_status === 'paid' && sess.status === 'complete')
check('stripe: charged in the store currency (USD), not a converted currency', sess.currency === 'usd' && sess.amount_total === 3300, `${sess.currency} ${sess.amount_total}`)
const pi = await stripe.paymentIntents.retrieve(sess.payment_intent)
check('stripe: the payment intent succeeded for exactly 3300 cents', pi.status === 'succeeded' && pi.amount_received === 3300)
check('order: our payment record points at that same payment intent', order && (await api('GET', `/stores/${storeId}/orders/${order.id}`, { token: tok })).json.payments[0].status === 'succeeded')

// ================= 2. a declined card creates no order =================
const ordersBefore = (await api('GET', `/stores/${storeId}/orders`, { token: tok })).json.pagination.total
try {
  await ctx.clearCookies()
  await page.evaluate(() => localStorage.clear()).catch(() => undefined)
  const bad = await buyOnStripe({ card: '4000000000000002', qty: 1 })
  await page.getByText(/declined|card was declined/i).first().waitFor({ timeout: 30000 })
  check('declined card: Stripe refuses the payment on its own page', true)
  await page.screenshot({ path: path.join(SHOTS, 'stripe-4-declined.png') })
  await sleep(4000)
  const after = (await api('GET', `/stores/${storeId}/orders`, { token: tok })).json.pagination.total
  check('declined card: no order was created and stock is untouched', after === ordersBefore && (await stockOf()) === 4, `orders ${ordersBefore} to ${after}`)
  void bad
} catch (e) {
  failures++
  console.log(`FAIL  declined card flow  (${String(e.message).split('\n')[0]})  url=${page.url()}`)
  await page.screenshot({ path: path.join(SHOTS, 'stripe-failure-2.png') }).catch(() => undefined)
}

// ================= 3. a real refund =================
const refund = await api('POST', `/stores/${storeId}/orders/${order.id}/refund`, { token: tok, body: { reason: 'Real Stripe test', restock: true } })
check('refund: the API accepted the refund and marked the order refunded', refund.status === 200 && refund.json.status === 'refunded', `HTTP ${refund.status}`)
const refunds = await stripe.refunds.list({ payment_intent: sess.payment_intent })
check('refund: Stripe really created a refund for the full 3300 cents', refunds.data.length === 1 && refunds.data[0].amount === 3300 && ['succeeded', 'pending'].includes(refunds.data[0].status), refunds.data[0] ? `${refunds.data[0].status} ${refunds.data[0].amount}` : 'none')
check('refund: our record stores Stripe\'s refund id', !!refund.json.refunds?.[0])
check('refund: stock came back (4 to 6)', (await stockOf()) === 6)
const again = await api('POST', `/stores/${storeId}/orders/${order.id}/refund`, { token: tok, body: {} })
check('refund: a second refund is refused (409) and Stripe still shows exactly one refund', again.status === 409 && (await stripe.refunds.list({ payment_intent: sess.payment_intent })).data.length === 1)

// ================= 4. sold out while paying: automatic real refund =================
try {
  await ctx.clearCookies()
  await page.evaluate(() => localStorage.clear()).catch(() => undefined)
  const race = await buyOnStripe({
    qty: 3,
    beforePay: async () => {
      // someone else buys the stock while this shopper is on Stripe's page
      await api('PUT', `/stores/${storeId}/products/${mug.id}`, { token: tok, body: { title: 'Ceramic Mug', price: 12.5, stock: 0, category: 'kitchen' } })
    },
  })
  await page.waitForURL(/checkout\/success/, { timeout: 60000 })
  await page.getByRole('heading', { name: 'Sorry, an item sold out' }).waitFor({ timeout: 40000 })
  check('sold out mid-payment: the shopper is told they were refunded', true)
  await page.screenshot({ path: path.join(SHOTS, 'stripe-5-soldout.png') })
  const s2 = await stripe.checkout.sessions.retrieve(race.sessionId)
  const r2 = await waitFor(async () => { const l = await stripe.refunds.list({ payment_intent: s2.payment_intent }); return l.data.length ? l : null }, 20000)
  check('sold out mid-payment: Stripe really refunded the payment automatically', !!r2 && r2.data[0].amount === s2.amount_total, r2 ? `${r2.data[0].status} ${r2.data[0].amount}` : 'no refund found')
  const list = (await api('GET', `/stores/${storeId}/orders`, { token: tok })).json
  check('sold out mid-payment: no order was created for it', list.pagination.total === ordersBefore)
} catch (e) {
  failures++
  console.log(`FAIL  sold-out refund flow  (${String(e.message).split('\n')[0]})  url=${page.url()}`)
  await page.screenshot({ path: path.join(SHOTS, 'stripe-failure-3.png') }).catch(() => undefined)
}

await browser.close()
console.log(failures === 0 ? '\nAll real Stripe checks passed.' : `\n${failures} real Stripe check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
