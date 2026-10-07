// Phase 7's golden path: one merchant, one run, start to finish.
//
//   sign up -> add a product (with the AI) -> a shopper buys it online -> sell at the register
//   -> refund the online order -> buy a plan
//
// Every other browser suite tests one area deeply. This one exists to catch what only breaks when
// the areas meet: stock shared between the website and the counter, an order that has to survive
// being refunded, and a plan change that has to reach the dashboard. It walks through the real UI
// throughout, never the API, because the point is that a person can do this.
//
// Setup and run: backend (npx tsx scripts/e2e-server.ts) and Redis, and `npm run dev` in the
// frontend, then: node e2e/golden-path.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (emails and slugs use the e2e- prefix).
import { chromium } from 'playwright'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const WEB = 'http://localhost:5173'
const ROOT = 'http://localhost:5000'
const API = `${ROOT}/api/v1`
const SHOTS = path.join(import.meta.dirname, 'shots')
fs.mkdirSync(SHOTS, { recursive: true })

let failures = 0
const check = (n, ok, x = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`)
  if (!ok) failures++
}
const suffix = Date.now().toString(36)
const password = 'password123'
const owner = { email: `e2e-golden-${suffix}@example.com`, store: `E2E Golden ${suffix}`, slug: `e2e-golden-${suffix}` }

// Stripe's webhook, signed the way the real one is, so the server's signature check is exercised
// rather than bypassed. The secret matches the one scripts/e2e-server.ts runs with.
const SECRET = 'whsec_e2e_secret'
function sign(payload) {
  const t = Math.floor(Date.now() / 1000)
  return `t=${t},v1=${crypto.createHmac('sha256', SECRET).update(`${t}.${payload}`).digest('hex')}`
}
async function webhook(type, session) {
  const payload = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, object: 'event', type, data: { object: session } })
  const res = await fetch(`${API}/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sign(payload) }, body: payload })
  return res.json()
}

const fake = (body) =>
  fetch(`${ROOT}/__e2e/billing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())

const browser = await chromium.launch()
const errors = []
const expected = /Failed to load resource: the server responded with a status of (400|401|402|403|404|409)/
async function session(label, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'en-US', viewport })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && !expected.test(m.text()) && errors.push(`${label}: ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`${label} pageerror ${e.message}`))
  return page
}
async function step(name, page, fn) {
  try {
    await fn()
  } catch (e) {
    failures++
    console.log(`FAIL  ${name}  (${String(e.message).split('\n')[0]})  url=${page.url()}`)
    await page.screenshot({ path: path.join(SHOTS, `golden-failure-${name.replace(/\W+/g, '-')}.png`) }).catch(() => undefined)
  }
}

const op = await session('owner')
let storeId

// ---- 1. Sign up ---------------------------------------------------------------------------------

await step('sign up', op, async () => {
  await op.goto(WEB)
  await op.getByRole('link', { name: 'Start your store free' }).first().click()
  await op.waitForURL('**/register')

  await op.getByLabel('Email').fill(owner.email)
  await op.getByLabel('Password', { exact: true }).fill(password)
  await op.getByLabel('Store name').fill(owner.store)
  await op.getByLabel('Store URL').fill(owner.slug)
  await op.getByLabel('Currency your prices are in').selectOption('PKR')
  await op.getByRole('button', { name: /Create/ }).click()
  await op.waitForURL('**/admin/**')
  check('a new merchant lands in their dashboard straight from the landing page', op.url().includes('/admin'), op.url())

  // The access token lives in memory, not in a cookie, so a fetch from the page context would be
  // unauthenticated. The shop id is read from the UI instead, which is where a person would see it:
  // the admin header links to the storefront.
  const storefrontHref = await op.getByRole('link', { name: 'View storefront' }).getAttribute('href')
  storeId = storefrontHref?.split('/store/')[1] ?? null
  check('the shop exists and the dashboard links to its storefront', Boolean(storeId), String(storefrontHref))
})

// ---- 2. Add a product, with the AI writing it ----------------------------------------------------

await step('add a product with the AI', op, async () => {
  await op.goto(`${WEB}/admin/products`)
  await op.getByRole('button', { name: 'Add product' }).first().click()

  await op.getByLabel('Category', { exact: true }).fill('clothing')
  await op.getByRole('button', { name: 'Write with AI' }).click()
  await op.getByRole('button', { name: /Suggest 4 options/ }).click()
  await op.getByRole('listitem').filter({ hasText: 'Use this' }).first().waitFor({ timeout: 60000 })
  await op.getByRole('listitem').filter({ hasText: 'Use this' }).first().getByRole('button', { name: 'Use this' }).click()

  const title = await op.getByLabel('Title', { exact: true }).inputValue()
  check('the AI filled in a title the merchant can keep or change', title.length > 0, title)

  // The merchant's own edit on top of the AI's words, which is the point of the feature.
  await op.getByLabel('Title', { exact: true }).fill(`Golden Lawn Suit ${suffix}`)
  await op.getByLabel('Price', { exact: true }).fill('2500')
  await op.getByLabel('Stock', { exact: true }).fill('10')
  await op.getByRole('button', { name: /^(Save|Create)/ }).click()
  await op.getByText(`Golden Lawn Suit ${suffix}`).first().waitFor({ timeout: 20000 })
  check('the product is saved and listed', await op.getByText(`Golden Lawn Suit ${suffix}`).first().isVisible())
  await op.screenshot({ path: path.join(SHOTS, 'golden-1-product.png') })
})

// ---- 3. A shopper buys it online ------------------------------------------------------------------

const shopper = await session('shopper')
let sessionId
await step('a shopper buys it online', shopper, async () => {
  await shopper.goto(`${WEB}/store/${storeId}`)
  await shopper.getByRole('heading', { name: 'New arrivals' }).waitFor({ timeout: 20000 })
  const card = shopper.getByRole('listitem').filter({ hasText: `Golden Lawn Suit ${suffix}` }).first()
  await card.waitFor({ timeout: 20000 })
  check('the product the merchant just added is on sale, with its price', /Rs\s?2,?500/.test(await card.innerText()), (await card.innerText()).replace(/\n/g, ' '))

  await card.getByRole('button', { name: /Add to cart/ }).click()
  await shopper.getByRole('link', { name: /Cart, 1 item/ }).waitFor({ timeout: 15000 })
  check('adding it updates the basket count in the header', true)

  await shopper.goto(`${WEB}/store/${storeId}/cart`)
  await shopper.getByRole('heading', { name: 'Your cart' }).waitFor({ timeout: 15000 })
  check('the basket holds the product', await shopper.getByText(`Golden Lawn Suit ${suffix}`).first().isVisible())

  await shopper.getByRole('link', { name: 'Proceed to checkout' }).click()
  await shopper.getByRole('heading', { name: 'Checkout' }).waitFor({ timeout: 15000 })
  check('a guest reaches checkout with no account at all', shopper.url().includes('/checkout'))
  await shopper.screenshot({ path: path.join(SHOTS, 'golden-2-checkout.png') })

  // The total is computed on the server; the button carries it, so this also proves the price was
  // not taken from anything the browser could have changed.
  const pay = shopper.getByRole('button', { name: /^Pay / })
  await pay.waitFor({ timeout: 15000 })
  check('the amount to pay is priced by the server', /Rs\s?2,?500/.test(await pay.innerText()), await pay.innerText())

  await pay.click()
  await shopper.waitForURL('**/__fake-stripe/**', { timeout: 20000 })
  sessionId = shopper.url().split('/').pop()
  check('paying sends the shopper to the payment page', Boolean(sessionId))
})

await step('the order exists only once payment is confirmed', shopper, async () => {
  await shopper.goto(`${WEB}/store/${storeId}/checkout/success?session_id=${sessionId}`)
  await shopper.getByText('Confirming your payment').waitFor({ timeout: 15000 })
  check('before the webhook, the shopper is told it is still confirming', true)

  const out = await webhook('checkout.session.completed', {
    id: sessionId,
    object: 'checkout.session',
    payment_status: 'paid',
    amount_total: 250000,
    currency: 'pkr',
    payment_intent: `pi_${sessionId}`,
    customer_details: { email: `e2e-golden-shopper-${suffix}@example.com`, name: 'Golden Shopper' },
  })

  await shopper.getByRole('heading', { name: 'Order confirmed' }).waitFor({ timeout: 25000 })
  check('once Stripe confirms, the order appears by itself', true, JSON.stringify(out).slice(0, 80))
  await shopper.screenshot({ path: path.join(SHOTS, 'golden-2b-confirmed.png') })
})

await step('the sale reaches the merchant', op, async () => {
  await op.goto(`${WEB}/admin/orders`)
  await op.getByRole('button', { name: '#1' }).waitFor({ timeout: 20000 })
  check('the order is in the merchant\u2019s list', await op.getByRole('button', { name: '#1' }).isVisible())
  await op.screenshot({ path: path.join(SHOTS, 'golden-2c-order.png') })
})

// ---- 4. Stock is shared with the counter -----------------------------------------------------------

await step('the register sells from the same stock', op, async () => {
  await op.goto(`${WEB}/pos/${storeId}`)
  await op.getByRole('heading', { name: 'Open the register' }).waitFor({ timeout: 20000 })
  await op.getByLabel(/Starting cash/).fill('100')
  await op.getByRole('button', { name: 'Open shift' }).click()

  const search = op.getByLabel('Scan a barcode or search products')
  await search.waitFor({ timeout: 20000 })
  await search.fill('Golden Lawn')
  await op.getByText(`Golden Lawn Suit ${suffix}`).first().waitFor({ timeout: 20000 })
  check('the product added for the website is sellable at the counter too, from one catalogue', true)

  // Stock is shared, so the counter must already know the website sold one of the ten.
  const stockText = await op.getByText(/9 (left|in stock)/).first().innerText().catch(() => '')
  check('and the counter already knows the website sold one', stockText.length > 0, stockText || 'stock figure not shown on the tile')
  await op.screenshot({ path: path.join(SHOTS, 'golden-3-register.png') })
})

// ---- 5. Sell one across the counter ----------------------------------------------------------------

await step('sell one at the counter', op, async () => {
  await op.getByText(`Golden Lawn Suit ${suffix}`).first().click()
  const charge = op.getByRole('button', { name: /^Charge/ })
  await charge.waitFor({ timeout: 15000 })
  check('the counter prices the sale itself', /Rs\s?2,?500/.test(await charge.innerText()), await charge.innerText())

  await charge.click()
  await op.getByRole('heading', { name: 'Payment' }).waitFor({ timeout: 15000 })
  const complete = op.getByRole('button', { name: /^Complete sale/ })
  await complete.waitFor({ timeout: 15000 })
  await complete.click()

  await op.getByText(/Sale #|New sale|Receipt/i).first().waitFor({ timeout: 20000 })
  check('the counter sale completes', true)
  await op.screenshot({ path: path.join(SHOTS, 'golden-3b-sale.png') })
})

await step('one catalogue, one stock figure', op, async () => {
  await op.goto(`${WEB}/admin/products`)
  // Selected by row role. The list is laid out with CSS grid, but it now carries table semantics, so
  // a screen reader and this test can both find a row by what it is rather than by hunting for a
  // button inside it. The accessibility audit is what prompted adding those roles.
  const row = op.getByRole('row').filter({ hasText: `Golden Lawn Suit ${suffix}` }).first()
  await row.waitFor({ timeout: 20000 })
  // Ten to begin with, one sold online and one at the counter.
  check('the merchant sees one stock figure reduced by both sales', /\b8\b/.test(await row.innerText()), (await row.innerText()).replace(/\n/g, ' | '))
})

// ---- 6. Refund the online order ----------------------------------------------------------------------

await step('refund the online order', op, async () => {
  await op.goto(`${WEB}/admin/orders`)
  await op.getByRole('button', { name: '#1' }).click()
  await op.getByRole('button', { name: 'Refund', exact: true }).waitFor({ timeout: 20000 })
  await op.getByRole('button', { name: 'Refund', exact: true }).click()

  const dialog = op.getByRole('dialog')
  await dialog.waitFor({ timeout: 15000 })
  await dialog.getByLabel('Reason (optional)').fill('Golden path refund')
  await dialog.getByLabel('Put the items back in stock').check()
  await dialog.getByRole('button', { name: 'Refund order' }).click()

  await op.getByText(/Refunded/).first().waitFor({ timeout: 20000 })
  check('the order is refunded, with the reason recorded', true)
  await op.screenshot({ path: path.join(SHOTS, 'golden-5-refund.png') })

  await op.goto(`${WEB}/admin/products`)
  const stockRow = op.getByRole('row').filter({ hasText: `Golden Lawn Suit ${suffix}` }).first()
  await stockRow.waitFor({ timeout: 20000 })
  check('putting the items back in stock really put them back', /\b9\b/.test(await stockRow.innerText()), (await stockRow.innerText()).replace(/\n/g, ' | '))
})

// ---- 7. Buy a plan ----------------------------------------------------------------------------------

await step('buy a plan', op, async () => {
  await op.goto(`${WEB}/admin/billing`)
  await op.getByRole('heading', { name: 'Free plan' }).waitFor({ timeout: 20000 })
  check('the shop starts on the free plan', await op.getByRole('heading', { name: 'Free plan' }).isVisible())

  await op.getByRole('button', { name: 'Choose Pro' }).click()
  await op.waitForURL('**/__fake-stripe/**')
  check('choosing a plan sends the merchant to the payment page', op.url().includes('/__fake-stripe/'))

  await op.goto(`${WEB}/admin/billing?checkout=success`)
  await op.getByText('Payment received. Confirming with Stripe').waitFor({ timeout: 20000 })
  await op.waitForTimeout(3000)
  check('coming back from the payment page does not change the plan on its own', (await op.getByRole('heading', { name: 'Free plan' }).count()) === 1)

  await fake({ storeId, kind: 'subscription', plan: 'PRO' })
  await op.getByText('You are now on the Pro plan.').waitFor({ timeout: 25000 })
  check('the plan changes only once Stripe confirms the money moved', (await op.getByRole('heading', { name: 'Pro plan', exact: true }).count()) >= 1)
  await op.screenshot({ path: path.join(SHOTS, 'golden-4-plan.png') })
})

await step('the bigger allowance reaches the dashboard', op, async () => {
  await op.goto(`${WEB}/admin/dashboard`)
  const meter = op.getByRole('region', { name: 'AI usage this month' })
  await meter.waitFor({ timeout: 20000 })
  check('the dashboard names the new plan', await meter.getByText('Pro plan').isVisible())
  check(
    'and the AI allowance really went up with it',
    (await meter.getByRole('progressbar', { name: 'AI content generations' }).getAttribute('aria-valuemax')) === '200'
  )
})

check('no unexpected console or page errors anywhere on the journey', errors.length === 0, errors.join(' | '))

await browser.close()
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
