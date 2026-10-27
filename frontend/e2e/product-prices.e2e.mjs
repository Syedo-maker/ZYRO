// The three prices, in a real browser (the supervisor's product-listing change, discount modes
// 2026-10-23): the owner types the price (MRP) and an optional discount in Rs or %, with a switch
// that converts the value rather than clearing it, and the selling price customers pay fills in as
// the third, read-only field; a discount that breaks the rules is refused; the admin list, the shop's
// product card and the product page show the selling price, the MRP struck through and a badge in
// the owner's terms ("Rs 200 off", "15% off"); a cash on delivery order tells the shopper what they
// saved, and so does the order in the admin.
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
await api('PATCH', `/stores/${storeId}/payments/settings`, { token, body: { codEnabled: true } })

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

  // ---- The form: MRP, a discount in Rs or %, and what customers pay
  await page.goto(`${WEB}/admin/products`)
  await page.getByRole('button', { name: '+ Add product' }).click()
  const mrp = page.getByLabel('Price (MRP)')
  const discount = page.getByLabel('Discount (optional)')
  const inRs = page.getByRole('button', { name: 'Discount in PKR' })
  const inPercent = page.getByRole('button', { name: 'Discount in percent' })
  const selling = page.getByLabel('Selling price (what customers pay)')
  const preview = page.locator('#price-preview')
  check(
    'Add Product shows the three prices: MRP, a discount with a Rs / % switch, and the selling price',
    (await mrp.isVisible()) && (await discount.isVisible()) && (await inRs.isVisible()) && (await inPercent.isVisible()) && (await selling.isVisible()),
  )
  check('the switch starts on Rs, and reads "Rs"', (await inRs.getAttribute('aria-pressed')) === 'true' && (await inRs.innerText()).trim() === 'Rs')
  check('the selling price is worked out, not typed', (await selling.getAttribute('readonly')) !== null && (await selling.inputValue()) === '')

  await page.locator('#title').fill('Copper Kettle')
  await mrp.fill('1000')
  check('with only the MRP, the selling price is the MRP', /1,000/.test(await selling.inputValue()), await selling.inputValue())
  await discount.fill('150')
  check('Rs 150 off: customers pay Rs 850, shown live', /850/.test(await selling.inputValue()) && /minus Rs\s150: customers pay Rs\s850/.test(await preview.innerText()), await preview.innerText())

  await inPercent.click()
  check('switching to % converts the value instead of clearing it: 15%', (await discount.inputValue()) === '15' && (await inPercent.getAttribute('aria-pressed')) === 'true')
  check('and the selling price is unchanged', /850/.test(await selling.inputValue()), await preview.innerText())
  await inRs.click()
  check('switching back gives Rs 150 again', (await discount.inputValue()) === '150')

  // Where converting rounds, switching straight back still returns what was typed.
  await mrp.fill('999')
  await discount.fill('333')
  await inPercent.click()
  check('Rs 333 off 999 is 33.33%, and customers pay Rs 666.03', (await discount.inputValue()) === '33.33' && /666\.03/.test(await selling.inputValue()), await selling.inputValue())
  await inRs.click()
  check('switching straight back restores exactly Rs 333, not the rounded Rs 332.97', (await discount.inputValue()) === '333' && /666(?!\.)/.test(await selling.inputValue()), await selling.inputValue())

  // The rules, as typed and on Save.
  await mrp.fill('1000')
  await inPercent.click()
  await discount.fill('120')
  check('120% is flagged as typed', /less than 100%/.test(await preview.innerText()) && (await selling.inputValue()) === '', await preview.innerText())
  await page.locator('#stock').fill('5')
  await page.getByLabel('Category').selectOption({ label: 'Kitchen' })
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('alert').waitFor()
  check('and saving it is refused, saying why', /less than 100%/.test(await page.getByRole('alert').innerText()))
  await inRs.click()
  await discount.fill('1000')
  check('a discount as large as the MRP is refused too', /must be less than the price \(MRP\)/.test(await preview.innerText()), await preview.innerText())

  await inPercent.click()
  await discount.fill('15')
  check('15% off: customers pay Rs 850', /850/.test(await selling.inputValue()) && /minus 15% \(Rs\s150\): customers pay Rs\s850/.test(await preview.innerText()), await preview.innerText())
  await page.getByRole('button', { name: 'Save' }).click()
  const row = page.getByRole('row').filter({ hasText: 'Copper Kettle' })
  await row.waitFor()
  const rowText = await row.innerText()
  check('the product list shows the selling price, the MRP and "15% off"', /850/.test(rowText) && /1,000/.test(rowText) && /15% off/.test(rowText), rowText.replace(/\s+/g, ' '))
  check('the MRP in the list is struck through', (await row.locator('s').count()) === 1)
  const saved = (await api('GET', `/stores/${storeId}/products?limit=5`)).json.data.find((p) => p.title === 'Copper Kettle')
  check('the server stored the type and value with the selling price', saved?.discountType === 'percent' && saved.discountValue === 15 && saved.salePrice === 850, JSON.stringify(saved && { t: saved.discountType, v: saved.discountValue, s: saved.salePrice }))

  // ---- Editing: the form opens as saved; a change to Rs is saved and shown as "Rs off"
  await page.getByRole('button', { name: 'Edit Copper Kettle' }).click()
  check(
    'the edit form opens with all three prices, on %',
    (await mrp.inputValue()) === '1000' && (await discount.inputValue()) === '15' && (await inPercent.getAttribute('aria-pressed')) === 'true' && /850/.test(await selling.inputValue()),
  )
  await inRs.click()
  await discount.fill('200')
  await page.getByRole('button', { name: 'Save' }).click()
  await row.filter({ hasText: /Rs\s200 off/ }).waitFor()
  check('switched to Rs 200 off, the list says "Rs 200 off"', /800/.test(await row.innerText()))

  // ---- The shop
  const product = (await api('GET', `/stores/${storeId}/products?limit=5`)).json.data.find((p) => p.title === 'Copper Kettle')
  await api('PATCH', `/stores/${storeId}/products/${product.id}/stock`, { token, body: { stock: 5 } })
  const shop = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  shop.on('pageerror', (e) => problems.push(e.message))
  await shop.goto(`${WEB}/store/${storeId}`)
  const card = shop.locator('li').filter({ hasText: 'Copper Kettle' })
  await card.waitFor({ timeout: 15000 })
  const cardText = await card.innerText()
  check('the product card shows the selling price, the struck MRP and "Rs 200 off"', /800/.test(cardText) && (await card.locator('s').innerText()).includes('1,000') && /Rs\s200 off/.test(cardText), cardText.replace(/\s+/g, ' '))
  await shop.goto(`${WEB}/store/${storeId}/products/${product.id}`)
  await shop.getByRole('heading', { name: 'Copper Kettle' }).waitFor()
  const main = await shop.locator('main').innerText()
  check('the product page shows the same three', /800/.test(main) && /1,000/.test(main) && /Rs\s200 off/.test(main))
  check('a screen reader hears "now" and "was", not just a strike', (await shop.locator('main s').first().innerText()).includes('1,000') && (await shop.getByText('was', { exact: false }).count()) > 0)

  // ---- A shopper buys two, cash on delivery, and is told what they saved
  for (let i = 0; i < 2; i++) await shop.getByRole('button', { name: /Add to cart/i }).click()
  await shop.goto(`${WEB}/store/${storeId}/checkout`)
  await shop.getByRole('heading', { name: 'Checkout' }).waitFor()
  await shop.getByText('Cash on delivery', { exact: true }).click()
  await shop.getByLabel('Full name').fill('Ayesha Khan')
  await shop.getByLabel('Phone number').fill('03001234567')
  await shop.getByLabel('Address', { exact: true }).fill('12 Mall Road')
  await shop.getByLabel('City').fill('Lahore')
  await shop.getByLabel('Country code').fill('PK')
  await shop.getByRole('button', { name: /Place order for/ }).click()
  await shop.getByRole('heading', { name: /your order is placed/i }).waitFor()
  check('the order placed page says "You saved Rs 400"', await shop.getByText(/You saved Rs\s400 on this order\./).isVisible())

  // The owner then ends the discount; the order keeps what it was sold at.
  await api('PUT', `/stores/${storeId}/products/${product.id}`, { token, body: { title: 'Copper Kettle', stock: 3, categoryId: product.categoryId, actualPrice: 1200 } })
  const orders = (await api('GET', `/stores/${storeId}/orders?limit=5`, { token })).json.data
  const line = orders[0]?.items[0]
  check('the order line kept the price paid, the MRP and the discount after the price changed', line?.unitPrice === 800 && line.unitMrp === 1000 && line.unitDiscount === 200 && orders[0].savings === 400, JSON.stringify(line))
  await page.goto(`${WEB}/admin/orders`)
  await page.getByText(`#${orders[0].orderNumber}`).first().click()
  await page.getByText('Saved on product discounts').waitFor({ timeout: 15000 })
  check('the order in the admin shows what was saved', /Saved on product discounts\s*Rs\s400/.test(await page.locator('body').innerText()))
  await shop.close()
} catch (err) {
  check('browser journey', false, err.message.split('\n')[0])
} finally {
  await browser.close()
}
check('no script errors', problems.length === 0, problems[0])
console.log(failures ? `\n${failures} failed` : '\nAll passed')
process.exit(failures ? 1 : 0)
