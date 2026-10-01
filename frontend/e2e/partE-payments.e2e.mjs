// Browser test for Part E, payment and trust. A shop turns on cash on delivery and bank transfer,
// a shopper places a COD order from the storefront, the merchant sees it with the reasons behind its
// trust score and marks the cash collected; a second shopper pays by transfer and uploads a receipt,
// which the merchant accepts; a courier file is reconciled line by line; and the pages fit a phone.
//
// Setup and run: backend e2e server (npx tsx scripts/e2e-server.ts) and Redis, and `npm run dev`
// in the frontend, then: node e2e/partE-payments.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (slugs and emails use the e2e- prefix).
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
const SHOTS = path.join(import.meta.dirname, 'shots')
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

// ---- A shop that takes cash on delivery and bank transfer ----
const ownerEmail = `e2e-pe-owner-${suffix}@example.com`
const reg = await api('POST', '/auth/register', { body: { email: ownerEmail, password, storeName: `Pay Shop ${suffix}`, storeSlug: `e2e-pe-${suffix}`, currency: 'PKR' } })
const token = reg.json.accessToken
const storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
const cup = (await api('POST', `/stores/${storeId}/products`, { token, body: { title: 'Clay Chai Cup', price: 450, stock: 40, category: 'kitchen' } })).json.id
await api('PATCH', `/stores/${storeId}/payments/settings`, {
  token,
  body: { codEnabled: true, bankTransferEnabled: true, bankAccountName: 'Pay Shop', bankAccountNumber: 'PK00TEST11112222', bankName: 'Test Bank' },
})

const browser = await chromium.launch()
const errors = []
const expected = /Failed to load resource: the server responded with a status of (400|401|402|403|404|409)/
async function session(label, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'en-US', viewport })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && !expected.test(m.text()) && errors.push(`${label}: ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`${label} pageerror ${e.message}`))
  return page
}
async function login(page, email) {
  await page.goto(`${WEB}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL('**/admin/**')
}
async function step(name, page, fn) {
  try {
    await fn()
  } catch (e) {
    failures++
    console.log(`FAIL  ${name}  (${String(e.message).split('\n')[0]})  url=${page.url()}`)
    await page.screenshot({ path: path.join(SHOTS, `pe-failure-${name.replace(/\W+/g, '-')}.png`) }).catch(() => undefined)
  }
}

/** Fills the delivery form a local payment method needs. */
async function fillDelivery(page, { name, phone }) {
  await page.getByLabel('Full name').fill(name)
  await page.getByLabel('Phone number').fill(phone)
  await page.getByLabel('Address', { exact: true }).fill('12 Mall Road')
  await page.getByLabel('City').fill('Lahore')
  await page.getByLabel('Country code').fill('PK')
}

async function addToCartAndCheckout(page, quantity) {
  await page.goto(`${WEB}/store/${storeId}/products`)
  await page.getByText('Clay Chai Cup').first().click()
  await page.getByRole('heading', { name: 'Clay Chai Cup' }).waitFor()
  for (let i = 0; i < quantity; i++) await page.getByRole('button', { name: /Add to cart/i }).click()
  await page.goto(`${WEB}/store/${storeId}/checkout`)
  await page.getByRole('heading', { name: 'Checkout' }).waitFor()
}

// ---- A shopper pays cash on delivery ----
const sp = await session('shopper-cod')
let codOrderNumber
await step('cash on delivery from the storefront', sp, async () => {
  await addToCartAndCheckout(sp, 2)
  const cod = sp.getByText('Cash on delivery', { exact: true })
  await cod.waitFor()
  check('checkout: cash on delivery is offered, and says the courier is paid on arrival', await sp.getByText(/Pay the courier in cash when your parcel arrives/).isVisible())
  await cod.click()
  await fillDelivery(sp, { name: 'Ayesha Khan', phone: '03001234567' })
  await sp.screenshot({ path: path.join(SHOTS, 'pe-checkout.png'), fullPage: true })
  await sp.getByRole('button', { name: /Place order for/ }).click()
  await sp.getByRole('heading', { name: /your order is placed/i }).waitFor()
  check('order placed: the shopper is told to pay the courier on arrival', await sp.getByText(/Pay the courier in cash when your parcel arrives/).isVisible())
  const orders = await api('GET', `/stores/${storeId}/payments/cod/pending`, { token })
  codOrderNumber = orders.json[0].orderNumber
  check('order: it is waiting for cash, for the full 900 rupees', orders.json.length === 1 && orders.json[0].total === 900, JSON.stringify(orders.json[0]?.risk?.band))
})

// ---- The merchant works the queue ----
const op = await session('owner')
await step('the merchant sees the queue and why', op, async () => {
  await login(op, ownerEmail)
  await op.getByRole('link', { name: 'Payments' }).click()
  const section = op.getByRole('region', { name: 'Cash on delivery' })
  await section.getByText(`#${codOrderNumber}`).waitFor()
  check('payments page: the order is listed with its total and a risk badge', /Rs\s?900/.test(await section.innerText()) && /Low risk/.test(await section.innerText()))
  await section.getByRole('button', { name: 'Why this score?' }).click()
  // Whichever rules fired, a band is never shown without the reasoning behind it.
  check('payments page: the reasons behind the score are shown in plain words', await section.getByText(/first cash-on-delivery order from this shopper|Nothing about this order stands out|cash deliveries/).first().isVisible())
  await op.screenshot({ path: path.join(SHOTS, 'pe-cod-queue.png'), fullPage: true })
  await section.getByRole('button', { name: 'Cash collected' }).click()
  await op.getByText(`Order #${codOrderNumber} is marked paid.`).waitFor()
  const order = await api('GET', `/stores/${storeId}/orders?limit=5`, { token })
  const paid = order.json.data.find((o) => o.orderNumber === codOrderNumber)
  check('cash collected: the order is now completed, not before', paid.status === 'completed')
})

// ---- A shopper pays by transfer and sends a receipt ----
const bp = await session('shopper-bank')
await step('bank transfer and its receipt', bp, async () => {
  await addToCartAndCheckout(bp, 1)
  await bp.getByText('Bank or wallet transfer').click()
  check('checkout: the shopper is shown where to send the money', await bp.getByText(/PK00TEST11112222/).isVisible())
  await fillDelivery(bp, { name: 'Bilal Ahmed', phone: '03009998888' })
  await bp.getByRole('button', { name: /Place order for/ }).click()
  await bp.getByRole('heading', { name: /your order is placed/i }).waitFor()

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  await bp.getByLabel('Screenshot').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: png })
  await bp.getByLabel('Amount you sent').fill('450')
  await bp.getByLabel(/Transfer reference/).fill(`TRX-${suffix}`)
  await bp.getByRole('button', { name: 'Send receipt' }).click()
  await bp.getByText(/Your receipt has been sent to the shop/).waitFor()
  check('receipt: the shopper is told it is waiting, and never shown the checks', !/finding|match/i.test(await bp.locator('main').innerText()))
})

await step('the merchant checks the receipt', op, async () => {
  await op.goto(`${WEB}/admin/payments`)
  const section = op.getByRole('region', { name: 'Payment screenshots' })
  await section.getByText(/Everything matches|Needs a look/).waitFor()
  check('payments page: the screenshot is shown with what was checked', await section.getByText(/The amount on the screenshot matches the order total/).isVisible())
  check('payments page: it says the decision is the merchant\'s, not the check\'s', /You decide: the check is a help, not a verdict/.test(await section.innerText()))
  await op.screenshot({ path: path.join(SHOTS, 'pe-proof.png'), fullPage: true })
  await section.getByRole('button', { name: 'Accept payment' }).click()
  await op.getByText(/is marked paid/).waitFor()
  check('accepting: that is what pays the order', true)
})

// ---- The courier's cash file ----
await step('reconciling a courier file', op, async () => {
  const pending = await api('GET', `/stores/${storeId}/payments/cod/pending`, { token })
  // One more COD order to reconcile against, placed through the API for speed.
  const csv = `CN No,Destination,COD Amount\nOrder #${codOrderNumber},Lahore,900\n999999,Quetta,100\n`
  const section = op.getByRole('region', { name: 'Courier cash' })
  await section.getByLabel('Courier', { exact: true }).fill('TCS')
  await section.getByLabel('CSV file').setInputFiles({ name: 'tcs.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await section.getByRole('button', { name: 'Check against my orders' }).click()
  // The result notice is an alert at the top of the page, not inside the section.
  await op.getByText(/lines matched your orders/).waitFor()
  const text = await section.innerText()
  check('courier file: each line is matched or flagged, with what to do', /Matched/.test(text) && /Unknown order/.test(text))
  check('courier file: it reads the courier\'s own column names', /999999/.test(text))
  check('courier file: pending orders are untouched by an import', (await api('GET', `/stores/${storeId}/payments/cod/pending`, { token })).json.length === pending.json.length)
  await op.screenshot({ path: path.join(SHOTS, 'pe-remittance.png'), fullPage: true })
})

// ---- Settings, staff and phone ----
await step('ways to pay in Settings', op, async () => {
  await op.goto(`${WEB}/admin/settings`)
  const panel = op.getByRole('region', { name: 'Payment methods' })
  await panel.waitFor()
  check('settings: cash on delivery and bank transfer are both shown as on', (await panel.getByLabel('Cash on delivery').isChecked()) && (await panel.getByLabel('Bank or wallet transfer').isChecked()))
  check('settings: it says the score never uses the name or area', /never from the shopper's name or area/.test(await panel.innerText()))
})

const stp = await session('staff')
await step('a cashier', stp, async () => {
  const staffEmail = `e2e-pe-staff-${suffix}@example.com`
  await api('POST', `/stores/${storeId}/staff`, { token, body: { email: staffEmail, password, permissions: ['pos_sell'] } })
  await login(stp, staffEmail)
  await stp.goto(`${WEB}/admin/payments`)
  await stp.waitForTimeout(800)
  check('staff: a cashier without orders_write cannot work the payments queue', !/Cash collected|Accept payment/.test(await stp.locator('body').innerText()))
})

const phone = await session('phone', { width: 375, height: 740 })
await step('phone', phone, async () => {
  await login(phone, ownerEmail)
  await phone.goto(`${WEB}/admin/payments`)
  await phone.getByRole('heading', { name: 'Payments' }).waitFor()
  const o1 = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('phone: the payments page fits a 375 px screen', o1 <= 0, `overflow ${o1}px`)
})

console.log(errors.length === 0 ? 'PASS  no console errors' : `FAIL  console errors:\n${errors.join('\n')}`)
if (errors.length) failures++
await browser.close()
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
