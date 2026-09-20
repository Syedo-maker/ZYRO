// Real Stripe check for discount codes: a code reaches Stripe as a coupon, Stripe's page shows
// the discount, the shopper pays with a real test card, the real webhook creates the order, and
// the amount Stripe charged equals the total ZYRO priced. Nothing about Stripe is faked.
//
// Needs the same setup as stripe-real.e2e.mjs (see documentation/Stripe_Setup_And_Verification.md):
//   - STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in backend/.env (a Stripe test sandbox)
//   - the real backend:   cd backend;  npm run dev
//   - the forwarder:      npx --yes @stripe/cli listen --forward-to localhost:5000/api/v1/webhooks/stripe
//   - Playwright:         cd frontend; npm install --no-save playwright
// Then:  cd frontend;  node e2e/stripe-discount.e2e.mjs      (afterwards: cleanup-test-data.ts in backend)
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
async function api(method, p, { token, guest, body } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(guest ? { 'X-Guest-Session-Id': guest } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, ms = 40000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await sleep(1000)
  }
  return null
}

// ---- setup: a store with a product, a shipping rate, 10% tax and a 20% code ----
const s = Date.now().toString(36)
const reg = await api('POST', '/auth/register', { body: { email: `stripe-disc-${s}@example.com`, password: 'password123', storeName: 'Discount Stripe Shop', storeSlug: `e2e-disc-${s}` } })
const tok = reg.json.accessToken
const storeId = (await api('GET', '/users/me/stores', { token: tok })).json[0].id
const mug = (await api('POST', `/stores/${storeId}/products`, { token: tok, body: { title: 'Ceramic Mug', price: 12.5, stock: 10, category: 'kitchen' } })).json
const zone = (await api('POST', `/stores/${storeId}/shipping-zones`, { token: tok, body: { name: 'Standard', region: 'US', rateAmount: 5.5 } })).json
execFileSync('npx.cmd', ['tsx', 'scripts/set-store-tax.ts', storeId, '10'], { cwd: BACKEND, shell: true, stdio: 'ignore' })
const code = await api('POST', `/stores/${storeId}/discount-codes`, { token: tok, body: { code: 'SAVE20', type: 'percentage', value: 20 } })
check('setup: the merchant created the code SAVE20 (20% off)', code.status === 201)

// 2 mugs = 25.00; 20% off = 5.00; tax on the discounted 20.00 = 2.00; shipping 5.50 (not discounted); total 27.50
const EXPECTED = { subtotal: 25, discount: 5, tax: 2, shipping: 5.5, total: 27.5 }
const guest = `stripe-disc-${s}-guestaaaa`
const startCheckout = async (g, extra = {}) => {
  await api('POST', `/stores/${storeId}/cart/items`, { guest: g, body: { productId: mug.id, quantity: 2 } })
  return api('POST', `/stores/${storeId}/checkout/session`, { guest: g, body: { shippingZoneId: zone.id, ...extra } })
}

const started = await startCheckout(guest, { discountCode: 'save20' })
check('checkout: a session with the code is created (HTTP 201) and returns Stripe\'s hosted page URL', started.status === 201 && /checkout\.stripe\.com/.test(started.json?.checkoutUrl ?? ''), `HTTP ${started.status} ${JSON.stringify(started.json).slice(0, 120)}`)
const quote = await api('POST', `/stores/${storeId}/checkout/quote`, { guest, body: { discountCode: 'save20', shippingZoneId: zone.id } })
check('quote: shows the same numbers ZYRO will charge (25.00 - 5.00 + 2.00 tax + 5.50 shipping = 27.50)', quote.json.discountAmount === EXPECTED.discount && quote.json.taxAmount === EXPECTED.tax && quote.json.total === EXPECTED.total, JSON.stringify(quote.json))

const sessionId = started.json.checkoutUrl.match(/cs_test_[A-Za-z0-9]+/)[0]
const browser = await chromium.launch()
const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 1000 } })
const page = await ctx.newPage()

// what Stripe holds before anyone pays: the discount is a real coupon on the session
const before = await stripe.checkout.sessions.retrieve(sessionId)
check('stripe: the session total is 27.50 and the discount is 5.00', before.amount_total === 2750 && before.total_details.amount_discount === 500, `total=${before.amount_total} discount=${before.total_details.amount_discount}`)
const couponId = before.discounts?.[0]?.coupon
const coupon = couponId ? await stripe.coupons.retrieve(couponId) : null
check('stripe: the discount is a fixed-amount coupon (5.00 off, USD) named after the code', !!coupon && coupon.amount_off === 500 && coupon.currency === 'usd' && coupon.name === 'Discount SAVE20', JSON.stringify({ id: couponId, amount_off: coupon?.amount_off, name: coupon?.name }))

try {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(started.json.checkoutUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await page.locator('#email').waitFor({ timeout: 30000 })
      break
    } catch (e) {
      if (attempt >= 3) throw e
      console.log(`  (loading Stripe's page failed: ${String(e.message).split('\n')[0]}; retrying ${attempt}/2)`)
    }
  }
  const pageText = await page.locator('body').innerText()
  check('stripe page: the shopper is asked to pay 27.50, the discounted total', /Pay\s\$27\.50/.test(pageText), pageText.replace(/\s+/g, ' ').slice(0, 160))
  await page.screenshot({ path: path.join(SHOTS, 'stripe-discount-1.png') })

  await page.locator('#email').fill('shopper@example.com')
  await page.locator('#shippingName').fill('Sam Shopper')
  await page.locator('#shippingCountry').selectOption('US')
  await page.locator('#shippingAddressLine1').fill('354 Oyster Point Blvd')
  await page.locator('#shippingLocality').fill('South San Francisco')
  const state = page.locator('#shippingAdministrativeArea')
  if (await state.count()) await state.selectOption('CA').catch(() => undefined)
  await page.locator('#shippingPostalCode').fill('94080')
  await page.locator('input[type="radio"]').first().check({ force: true, timeout: 10000 })
  await page.locator('#cardNumber').waitFor({ timeout: 15000 })
  await page.locator('#cardNumber').pressSequentially('4242424242424242', { delay: 30 })
  await page.locator('#cardExpiry').pressSequentially('1234', { delay: 30 })
  await page.locator('#cardCvc').pressSequentially('123', { delay: 30 })
  await page.getByTestId('hosted-payment-submit-button').click()
  await page.waitForURL(new RegExp(`${WEB.replace(/\./g, '\\.')}/store/.*checkout/success`), { timeout: 60000 })
  check('pay: Stripe accepted the test card and sent the shopper back to the storefront', true)
} catch (e) {
  failures++
  console.log(`FAIL  paying on Stripe  (${String(e.message).split('\n')[0]})  url=${page.url()}`)
  await page.screenshot({ path: path.join(SHOTS, 'stripe-discount-failure.png') }).catch(() => undefined)
}

const order = await waitFor(async () => (await api('GET', `/stores/${storeId}/orders`, { token: tok })).json?.data?.[0])
check('webhook: Stripe delivered the real event and the order exists (online, paid)', !!order && order.channel === 'online' && order.status === 'paid')
check('order: 27.50 total with the 5.00 discount and the code recorded, exactly as priced', order?.subtotal === EXPECTED.subtotal && order?.discountAmount === EXPECTED.discount && order?.taxAmount === EXPECTED.tax && order?.shippingAmount === EXPECTED.shipping && order?.total === EXPECTED.total && order?.discountCode === 'SAVE20', JSON.stringify({ s: order?.subtotal, d: order?.discountAmount, t: order?.taxAmount, sh: order?.shippingAmount, tot: order?.total, c: order?.discountCode }))
const codes = (await api('GET', `/stores/${storeId}/discount-codes`, { token: tok })).json
check('code: one use is counted and it is still active', codes[0].usageCount === 1 && codes[0].status === 'active')

const paid = await stripe.checkout.sessions.retrieve(sessionId)
check('stripe: the session is paid and Stripe charged exactly 27.50 in USD', paid.payment_status === 'paid' && paid.amount_total === 2750 && paid.currency === 'usd')
const pi = await stripe.paymentIntents.retrieve(paid.payment_intent)
check('stripe: the payment intent succeeded for exactly 2750 cents (what ZYRO priced)', pi.status === 'succeeded' && pi.amount_received === 2750)

// a second checkout with the same code reuses the same coupon instead of creating another
const guest2 = `stripe-disc-${s}-guestbbbb`
const second = await startCheckout(guest2, { discountCode: 'SAVE20' })
const sid2 = second.json?.checkoutUrl?.match(/cs_test_[A-Za-z0-9]+/)?.[0]
const s2 = sid2 ? await stripe.checkout.sessions.retrieve(sid2) : null
check('stripe: a second checkout with the same code reuses the same coupon', !!s2 && !!couponId && s2.discounts?.[0]?.coupon === couponId && s2.amount_total === 2750)

// a code that cannot be used never reaches Stripe
await api('PATCH', `/stores/${storeId}/discount-codes/${codes[0].id}`, { token: tok, body: { active: false } })
const guest3 = `stripe-disc-${s}-guestcccc`
const refused = await startCheckout(guest3, { discountCode: 'SAVE20' })
check('checkout: a switched-off code is refused with a clear reason and no Stripe session is made', refused.status === 400 && /no longer available/.test(refused.json?.detail ?? ''))

// refunding a discounted order gives back exactly what was charged
const refund = await api('POST', `/stores/${storeId}/orders/${order.id}/refund`, { token: tok, body: { reason: 'Real Stripe discount test' } })
const refunds = await stripe.refunds.list({ payment_intent: paid.payment_intent })
check('refund: Stripe refunded exactly the 2750 cents actually charged (not the undiscounted price)', refund.status === 200 && refunds.data.length === 1 && refunds.data[0].amount === 2750, refunds.data[0] ? `${refunds.data[0].amount}` : 'none')

await browser.close()
console.log(failures === 0 ? '\nAll real Stripe discount checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
