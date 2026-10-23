// Product Scout in a real browser (2026-10-22): the Trending products panel on the dashboard and the
// Products page, its filters, "Add to my store" (a prefilled Add Product form; nothing saved until Save),
// new-store onboarding, and who sees it (owner and Manager yes, Cashier no).
//
// Setup: the demo stores (cd backend; npm run demo:scout:add), the backend (npm run dev) and
// `npm run dev` in the frontend, then:  node e2e/product-scout.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (emails and slugs use the e2e- prefix). The demo
// store's product added here is removed by the test itself.
import { chromium } from 'playwright'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
const DEMO = { email: 'demo-scout-lahore-threads@demo.zyro.local', password: 'demo-pass-123' }
const suffix = Date.now().toString(36)
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

const demoLogin = await api('POST', '/auth/login', { body: DEMO })
if (demoLogin.status !== 200) {
  console.log('The demo stores are not there: run `npm run demo:scout:add` in backend first.')
  process.exit(1)
}
const demoToken = demoLogin.json.accessToken
const demoStoreId = (await api('GET', '/users/me/stores', { token: demoToken })).json[0].id

// A brand-new real store (for onboarding), with a manager and a cashier.
const ownerEmail = `e2e-scout-${suffix}@example.com`
const reg = await api('POST', '/auth/register', { body: { email: ownerEmail, password: 'password123', storeName: `E2E Scout ${suffix}`, storeSlug: `e2e-scout-${suffix}`, currency: 'PKR' } })
const newStoreId = (await api('GET', '/users/me/stores', { token: reg.json.accessToken })).json[0].id
for (const role of ['manager', 'cashier']) {
  await api('POST', `/stores/${newStoreId}/staff`, { token: reg.json.accessToken, body: { email: `e2e-scout-${suffix}-${role}@example.com`, password: 'staff-pass-123', role } })
}

const browser = await chromium.launch()
async function signIn(email, password) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(e.message))
  await page.goto(`${WEB}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /log in|sign in/i }).click()
  await page.waitForURL('**/admin/**')
  return { page, problems }
}
const panelOf = (page) => page.getByRole('complementary', { name: 'Trending products' })

let addedProductId = null
try {
  // ---- The panel on the dashboard, with the demo stores' figures
  const d = await signIn(DEMO.email, DEMO.password)
  await d.page.goto(`${WEB}/admin/dashboard`)
  const panel = panelOf(d.page)
  await panel.getByText('Top sellers').waitFor({ timeout: 15000 })
  const text = await panel.innerText()
  check('the dashboard has the Trending products panel, marked as demo data', /Trending products/.test(text) && /Demo data/.test(text))
  check('each product shows its real figures and why it is trending', /\d+ sold · \d+ orders · \d+ shops/.test(text) && /sold \d+ units|\d+ units/.test(text))
  check('no shop is named anywhere in it', !/Demo: |Karachi|Lahore Threads|Multan|Pindi|Quetta|Peshawar/.test(text))
  check('the 2-store kite and the one-shop-dominated brass lamp are never shown', !/Kite|Brass lamp/i.test(text))
  check('it says how the figures are protected', /at least 3 shops/.test(text))

  // Filters
  await panel.getByRole('button', { name: '30 days' }).click()
  await panel.locator('[aria-pressed="true"]', { hasText: '30 days' }).waitFor()
  await d.page.waitForTimeout(800)
  check('the period switches to 30 days', /last 30 days/.test(await panel.innerText()))
  await panel.getByLabel('Category').selectOption('Clothing')
  await d.page.waitForTimeout(1200)
  const clothing = await panel.locator('ul li p.text-xs').filter({ hasText: /^[A-Z]/ }).allInnerTexts()
  check('the category filter shows that category only', clothing.length > 0 && clothing.every((c) => c === 'Clothing'), clothing.join(', '))
  await panel.getByLabel('Category').selectOption('')

  // Collapse, and it stays collapsed
  await panel.getByRole('button', { name: 'Collapse trending products' }).click()
  await d.page.reload()
  await panelOf(d.page).getByRole('button', { name: /Trending products/ }).waitFor()
  check('the panel collapses, and stays collapsed after a reload', (await panelOf(d.page).getByText('Top sellers').count()) === 0)
  await panelOf(d.page).getByRole('button', { name: /Trending products/ }).click()
  await panelOf(d.page).getByText('Top sellers').waitFor()

  // ---- "Add to my store": a prefilled form, nothing saved until Save
  const before = (await api('GET', `/stores/${demoStoreId}/products?limit=100`)).json.data.length
  await panelOf(d.page).getByRole('button', { name: 'Add Clay chai cup to my store' }).first().click()
  await d.page.waitForURL('**/admin/products')
  await d.page.getByText('Started from Product Scout').waitFor({ timeout: 15000 })
  check('it opens the Add Product form with the suggested name and a draft description', (await d.page.locator('#title').inputValue()) === 'Clay chai cup' && (await d.page.locator('#description').inputValue()).length > 30)
  check('nothing has been added to the store yet', (await api('GET', `/stores/${demoStoreId}/products?limit=100`)).json.data.length === before)
  check('the price is left for the owner', (await d.page.getByLabel('Price (MRP)').inputValue()) === '')
  await d.page.getByRole('button', { name: 'Create “Kitchen”' }).click()
  await d.page.waitForFunction(() => document.querySelector('#category')?.selectedOptions?.[0]?.textContent === 'Kitchen', null, { timeout: 10000 })
  check('a missing category is created only on a click, and chosen', true)
  await d.page.getByLabel('Price (MRP)').fill('450')
  await d.page.getByLabel('Stock', { exact: true }).fill('10')
  await d.page.getByRole('button', { name: 'Save', exact: true }).click()
  await d.page.getByRole('row').filter({ hasText: 'Clay chai cup' }).waitFor({ timeout: 15000 })
  const after = (await api('GET', `/stores/${demoStoreId}/products?limit=100`)).json.data
  addedProductId = after.find((p) => p.title === 'Clay chai cup')?.id ?? null
  check('saved by the owner, it is added once', after.length === before + 1 && addedProductId !== null)
  check('no script errors (demo owner)', d.problems.length === 0, d.problems[0])

  // ---- Onboarding a brand-new store
  const o = await signIn(ownerEmail, 'password123')
  await o.page.goto(`${WEB}/admin/dashboard`)
  const op = panelOf(o.page)
  await op.getByText("Let's set up your shop").waitFor({ timeout: 15000 })
  check('a store with no products is walked through setting up', /Step 1 of 3/.test(await op.innerText()))
  await op.getByLabel('Something else? (optional)').fill('Shoes')
  await op.getByRole('button', { name: 'Next' }).click()
  await op.getByText('Create “Shoes”').waitFor()
  const catsBefore = (await api('GET', `/stores/${newStoreId}/categories`, { token: reg.json.accessToken })).json.length
  check('nothing is created before the owner confirms', catsBefore === 0)
  await op.getByRole('button', { name: /Create 1 category/ }).click()
  await op.getByText('Created: Shoes.').waitFor()
  const cats = (await api('GET', `/stores/${newStoreId}/categories`, { token: reg.json.accessToken })).json
  check('the confirmed category is created through the categories module', cats.length === 1 && cats[0].name === 'Shoes')
  await op.getByRole('button', { name: 'Done, show me the trends' }).click()
  await op.getByText(/Top sellers|Not enough sales across ZYRO shops/).first().waitFor()
  check('after setup, the panel shows the trends (or says there are not enough yet)', true)
  check('no script errors (new owner)', o.problems.length === 0, o.problems[0])

  // ---- Who sees it
  const m = await signIn(`e2e-scout-${suffix}-manager@example.com`, 'staff-pass-123')
  await m.page.goto(`${WEB}/admin/products`)
  await panelOf(m.page).waitFor({ timeout: 15000 })
  check('a Manager sees the panel', true)
  const c = await signIn(`e2e-scout-${suffix}-cashier@example.com`, 'staff-pass-123')
  await c.page.goto(`${WEB}/admin/products`)
  await c.page.getByRole('heading', { name: 'Products' }).waitFor()
  await c.page.waitForTimeout(1500)
  check('a Cashier does not', (await panelOf(c.page).count()) === 0)
} catch (err) {
  check('browser journey', false, err.message.split('\n')[0])
} finally {
  await browser.close()
  // Leave the demo store as it was.
  if (addedProductId) await api('DELETE', `/stores/${demoStoreId}/products/${addedProductId}`, { token: demoToken })
  const kitchen = (await api('GET', `/stores/${demoStoreId}/categories`, { token: demoToken })).json?.find((c) => c.name === 'Kitchen')
  if (kitchen) await api('DELETE', `/stores/${demoStoreId}/categories/${kitchen.id}`, { token: demoToken })
}
console.log(failures ? `\n${failures} failed` : '\nAll passed')
process.exit(failures ? 1 : 0)
