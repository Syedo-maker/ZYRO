// A store on a platform without Stripe (production readiness, STEP 5): the checkout offers only the
// ways to pay that work. Card payment is not shown; cash on delivery is chosen for the shopper and the
// order goes through; a store with no way to pay says so plainly instead of showing a "Pay" button.
//
// Setup: an e2e server started with E2E_NO_STRIPE=1, and a Vite dev server pointing at it. On spare
// ports, alongside the usual ones:
//   cd backend;  E2E_NO_STRIPE=1 PORT=5010 npx tsx scripts/e2e-server.ts
//   cd frontend; VITE_DEV_API_TARGET=http://localhost:5010 npx vite --port 5180 --strictPort
//   WEB=http://localhost:5180 node e2e/payments-no-stripe.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (emails and slugs use the e2e- prefix).
import { chromium } from 'playwright'

const WEB = process.env.WEB ?? 'http://localhost:5180'
const API = `${WEB}/api/v1`
const suffix = Date.now().toString(36)
let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}
async function api(method, p, { token, body } = {}) {
  const res = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text()
  return { status: res.status, json: t ? JSON.parse(t) : null }
}
async function shop(tag, settings) {
  const reg = await api('POST', '/auth/register', { body: { email: `e2e-nostripe-${tag}-${suffix}@example.com`, password: 'password123', storeName: `E2E No Stripe ${tag}`, storeSlug: `e2e-nostripe-${tag}-${suffix}`, currency: 'PKR' } })
  const token = reg.json.accessToken
  const storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
  const product = (await api('POST', `/stores/${storeId}/products`, { token, body: { title: 'Clay Chai Cup', price: 450, stock: 10, category: 'kitchen' } })).json.id
  if (settings) await api('PATCH', `/stores/${storeId}/payments/settings`, { token, body: settings })
  return { storeId, product }
}

const browser = await chromium.launch()
try {
  // A store taking cash on delivery and bank transfer.
  const open = await shop('open', { codEnabled: true, bankTransferEnabled: true, bankAccountName: 'E2E Shop', bankAccountNumber: 'PK00TEST1', bankName: 'Test Bank' })
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${WEB}/store/${open.storeId}/products/${open.product}`)
  await page.getByRole('button', { name: /add to cart/i }).first().click()
  await page.waitForTimeout(500)
  await page.goto(`${WEB}/store/${open.storeId}/checkout`)
  await page.getByRole('heading', { name: 'Checkout' }).waitFor()
  await page.getByRole('radio', { name: /cash on delivery/i }).waitFor()
  check('card payment is not offered without Stripe', (await page.getByRole('radio', { name: /^card/i }).count()) === 0)
  check('nothing mentions Stripe or a card page', !(await page.content()).includes("Stripe&apos;s secure payment page") && !(await page.content()).includes("Stripe's secure payment page"))
  check('cash on delivery is chosen for the shopper', await page.getByRole('radio', { name: /cash on delivery/i }).isChecked())
  check('bank transfer is offered too', (await page.getByRole('radio', { name: /bank or wallet transfer/i }).count()) === 1)
  await page.getByLabel(/full name/i).fill('Ayesha Khan')
  await page.getByLabel(/phone/i).fill('03001234567')
  await page.getByLabel(/address/i).first().fill('12 Mall Road')
  await page.getByLabel(/city/i).fill('Lahore')
  await page.getByRole('button', { name: /place order/i }).click()
  await page.waitForURL('**/checkout/placed**', { timeout: 15000 })
  check('the cash-on-delivery order goes through', page.url().includes('method=cod'))
  check('no script errors', errors.length === 0, errors.join(' | '))

  // A store that has not turned on any way to pay.
  const closed = await shop('closed', null)
  const p2 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  await p2.goto(`${WEB}/store/${closed.storeId}/products/${closed.product}`)
  await p2.getByRole('button', { name: /add to cart/i }).first().click()
  await p2.waitForTimeout(500)
  await p2.goto(`${WEB}/store/${closed.storeId}/checkout`)
  await p2.getByText('This store is not taking orders online at the moment').waitFor()
  check('a store with no way to pay says so plainly', true)
  check('and shows no Pay button', (await p2.getByRole('button', { name: /^pay/i }).count()) === 0)
} catch (err) {
  failures += 1
  console.log('FAIL  the journey stopped:', err.message)
} finally {
  await browser.close()
}
console.log(failures === 0 ? '\nAll no-Stripe checkout checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
