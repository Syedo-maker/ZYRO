// The quick stock control, in a real browser (the supervisor's product-listing change): on the products
// list an owner changes a product's stock (11 to 7) with the minus button or by typing, and saves it
// without opening the product; Escape puts the saved count back; the edit form has the same control.
//
// Setup: the backend (npm run dev or the e2e server) and `npm run dev` in the frontend, then:
//   node e2e/product-stock.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (emails and slugs use the e2e- prefix).
import { chromium } from 'playwright'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
const suffix = Date.now().toString(36)
const email = `e2e-stock-${suffix}@example.com`
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
  body: { email, password, storeName: `E2E Stock ${suffix}`, storeSlug: `e2e-stock-${suffix}`, currency: 'PKR' },
})
check('setup: a new store', reg.status === 201, String(reg.status))
const token = reg.json.accessToken
const storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
const lamp = (await api('POST', `/stores/${storeId}/products`, { token, body: { title: 'Desk Lamp', actualPrice: 2500, stock: 11, category: 'Home' } })).json
const stockNow = async () => (await api('GET', `/stores/${storeId}/products/${lamp.id}`)).json.stock

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
  await page.goto(`${WEB}/admin/products`)

  const field = page.getByLabel('Stock for Desk Lamp', { exact: true })
  await field.waitFor()
  check('each row has its own stock control, starting at the saved count', (await field.inputValue()) === '11')
  check('no Save button until the count changes', (await page.getByRole('button', { name: 'Save stock for Desk Lamp' }).count()) === 0)

  // ---- 11 to 7 with the minus button
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'One less (Stock for Desk Lamp)' }).click()
  check('the minus button steps the count down (11 to 7)', (await field.inputValue()) === '7')
  await page.getByRole('button', { name: 'Save stock for Desk Lamp' }).click()
  await page.getByRole('row').filter({ hasText: 'Desk Lamp' }).getByRole('status').filter({ hasText: 'Saved' }).waitFor()
  check('saving says so, on the row', true)
  check('the store now has 7', (await stockNow()) === 7, String(await stockNow()))
  await page.reload()
  await field.waitFor()
  check('after a reload the list shows 7', (await field.inputValue()) === '7')

  // ---- Typing and Enter; Escape undoes
  await field.fill('3')
  await field.press('Escape')
  check('Escape puts the saved count back', (await field.inputValue()) === '7')
  await field.fill('3')
  await field.press('Enter')
  await page.getByRole('row').filter({ hasText: 'Desk Lamp' }).getByRole('status').filter({ hasText: 'Saved' }).waitFor()
  check('typing a count and pressing Enter saves it', (await stockNow()) === 3)

  // ---- The shop sees it at once
  await page.goto(`${WEB}/store/${storeId}/products/${lamp.id}`)
  await page.getByRole('heading', { name: 'Desk Lamp' }).waitFor()
  check('the shop shows the new count straight away', /\b3\b/.test(await page.locator('main').innerText()))

  // ---- The edit form has the same control
  await page.goto(`${WEB}/admin/products`)
  await page.getByRole('button', { name: 'Edit Desk Lamp' }).click()
  const formStock = page.getByLabel('Stock', { exact: true })
  check('the edit form opens with the current count', (await formStock.inputValue()) === '3')
  await page.getByRole('button', { name: 'One more (Stock)' }).click()
  await page.getByRole('button', { name: 'One more (Stock)' }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'Edit Desk Lamp' }).waitFor()
  await page.waitForFunction(() => document.querySelector('[id^="stock-"]')?.value === '5', null, { timeout: 10000 }).catch(() => undefined)
  check('saving the form with the plus button used twice gives 5, and the list follows', (await stockNow()) === 5 && (await field.inputValue()) === '5', `${await stockNow()} / ${await field.inputValue()}`)

  // ---- Not below zero
  await field.fill('0')
  check('at 0 the minus button is off', await page.getByRole('button', { name: 'One less (Stock for Desk Lamp)' }).isDisabled())
  await field.fill('5')
} catch (err) {
  check('browser journey', false, err.message.split('\n')[0])
} finally {
  await browser.close()
}
check('no script errors', problems.length === 0, problems[0])
console.log(failures ? `\n${failures} failed` : '\nAll passed')
process.exit(failures ? 1 : 0)
