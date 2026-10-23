// The three prices, in a real browser (the supervisor's product-listing change): the owner types the
// price (MRP) and an optional discounted price, and the selling price customers will pay fills in as the
// third, read-only field; a discount above the MRP is refused; the admin list, the shop's product card
// and the product page show the sale price, the MRP struck through and a "% off" badge.
//
// Setup: the backend (npm run dev or the e2e server) and `npm run dev` in the frontend, then:
//   node e2e/product-prices.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (emails and slugs use the e2e- prefix).
import { chromium } from 'playwright'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
const suffix = Date.now().toString(36)
const email = `e2e-prices-${suffix}@example.com`
const password = 'password123'
let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}
const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

const reg = await api('POST', '/auth/register', {
  body: { email, password, storeName: `E2E Prices ${suffix}`, storeSlug: `e2e-prices-${suffix}`, currency: 'PKR' },
})
check('setup: a new store', reg.status === 201, String(reg.status))
const token = reg.json.accessToken
const storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
await api('POST', `/stores/${storeId}/categories`, { token, body: { name: 'Kitchen' } })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const problems = []
page.on('pageerror', (e) => problems.push(e.message))
try {
  await page.goto(`${WEB}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /log in|sign in/i }).click()
  await page.waitForURL('**/admin/**')

  // ---- The form: two prices, and what customers pay
  await page.goto(`${WEB}/admin/products`)
  await page.getByRole('button', { name: '+ Add product' }).click()
  const selling = page.getByLabel('Selling price (what customers pay)')
  check(
    'Add Product shows all three prices: MRP, discounted price and selling price',
    (await page.getByLabel('Price (MRP)').isVisible()) && (await page.getByLabel('Discounted price (optional)').isVisible()) && (await selling.isVisible()),
  )
  check('the selling price is worked out, not typed', (await selling.getAttribute('readonly')) !== null && (await selling.inputValue()) === '')
  await page.locator('#title').fill('Copper Kettle')
  await page.getByLabel('Price (MRP)').fill('1000')
  check('with only the MRP, the selling price is the MRP', /1,000/.test(await selling.inputValue()), await selling.inputValue())
  const preview = page.locator('#price-preview')
  check('with only the MRP, customers pay the MRP', /empty to sell at the MRP|Customers pay .*1,000/.test(await preview.innerText()), await preview.innerText())
  await page.getByLabel('Discounted price (optional)').fill('1200')
  check('a discount above the MRP is flagged as typed', /cannot be more than the price/.test(await preview.innerText()), await preview.innerText())
  await page.locator('#stock').fill('5')
  await page.getByLabel('Category').selectOption({ label: 'Kitchen' })
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('alert').waitFor()
  check('and saving it is refused, saying why', /cannot be more than/.test(await page.getByRole('alert').innerText()))

  await page.getByLabel('Discounted price (optional)').fill('800')
  check('a valid discount shows the sale price and the percent off', /Customers pay .*800.*20% off/.test(await preview.innerText()), await preview.innerText())
  check('and the selling price field follows it', /800/.test(await selling.inputValue()) && !/1,000/.test(await selling.inputValue()), await selling.inputValue())
  await page.getByRole('button', { name: 'Save' }).click()
  const row = page.getByRole('row').filter({ hasText: 'Copper Kettle' })
  await row.waitFor()
  const rowText = await row.innerText()
  check('the product list shows the sale price, the MRP and the badge', /800/.test(rowText) && /1,000/.test(rowText) && /20% off/.test(rowText), rowText.replace(/\s+/g, ' '))
  check('the MRP in the list is struck through', (await row.locator('s').count()) === 1)

  // ---- Editing: the form opens with both prices; removing the discount sells at the MRP
  await page.getByRole('button', { name: 'Edit Copper Kettle' }).click()
  check('the edit form opens with all three prices', (await page.getByLabel('Price (MRP)').inputValue()) === '1000' && (await page.getByLabel('Discounted price (optional)').inputValue()) === '800' && /800/.test(await page.getByLabel('Selling price (what customers pay)').inputValue()))
  await page.getByRole('button', { name: 'Cancel' }).click()

  // ---- The shop
  const product = (await api('GET', `/stores/${storeId}/products?limit=5`)).json.data.find((p) => p.title === 'Copper Kettle')
  await page.goto(`${WEB}/store/${storeId}`)
  const card = page.locator('li').filter({ hasText: 'Copper Kettle' })
  await card.waitFor({ timeout: 15000 })
  const cardText = await card.innerText()
  check('the product card shows the sale price, the struck MRP and "20% off"', /800/.test(cardText) && (await card.locator('s').innerText()).includes('1,000') && /20% off/.test(cardText), cardText.replace(/\s+/g, ' '))
  await page.goto(`${WEB}/store/${storeId}/products/${product.id}`)
  await page.getByRole('heading', { name: 'Copper Kettle' }).waitFor()
  const main = await page.locator('main').innerText()
  check('the product page shows the same three', /800/.test(main) && /1,000/.test(main) && /20% off/.test(main))
  check('a screen reader hears "now" and "was", not just a strike', (await page.locator('main s').first().innerText()).includes('1,000') && (await page.getByText('was', { exact: false }).count()) > 0)
} catch (err) {
  check('browser journey', false, err.message.split('\n')[0])
} finally {
  await browser.close()
}
check('no script errors', problems.length === 0, problems[0])
console.log(failures ? `\n${failures} failed` : '\nAll passed')
process.exit(failures ? 1 : 0)
