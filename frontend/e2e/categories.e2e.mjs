// Categories, in a real browser (the supervisor's product-listing change): the sidebar entry, the
// Categories page (create, duplicate refused, rename, disable, blocked delete), and the product form's
// category dropdown, including its prompt when the store has no categories yet.
//
// Setup: the backend (npm run dev or the e2e server) and `npm run dev` in the frontend, then:
//   node e2e/categories.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (emails and slugs use the e2e- prefix).
import { chromium } from 'playwright'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
const suffix = Date.now().toString(36)
const email = `e2e-categories-${suffix}@example.com`
const password = 'password123'
let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

const reg = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, storeName: `E2E Categories ${suffix}`, storeSlug: `e2e-categories-${suffix}`, currency: 'PKR' }),
})
check('setup: a new store', reg.status === 201, String(reg.status))

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

  // ---- The sidebar
  await page.locator('aside a', { hasText: 'Categories' }).waitFor({ timeout: 15000 })
  const labels = await page.locator('aside a').allInnerTexts()
  const at = (l) => labels.findIndex((x) => x.trim() === l)
  check('the sidebar has Categories, between Products and Orders', at('Categories') === at('Products') + 1 && at('Orders') === at('Categories') + 1, labels.join(' | '))

  // ---- A store with no categories: the form says what to do
  await page.goto(`${WEB}/admin/products`)
  await page.getByRole('button', { name: '+ Add product' }).click()
  const prompt = page.getByText('You have no categories yet.')
  await prompt.waitFor({ timeout: 15000 })
  check('with no categories, the form asks for one instead of offering a free-text box', (await page.locator('input#category').count()) === 0)
  await page.getByRole('link', { name: 'Create a category' }).click()
  await page.waitForURL('**/admin/categories')
  check('its link opens the Categories page', true)

  // ---- The Categories page
  await page.getByLabel('New category').fill('  Toys ')
  await page.getByRole('button', { name: 'Add category' }).click()
  await page.getByRole('row').filter({ hasText: 'Toys' }).waitFor()
  check('a category is added, its name tidied', (await page.getByRole('row').filter({ hasText: 'Toys' }).count()) === 1)
  await page.getByLabel('New category').fill('TOYS')
  await page.getByRole('button', { name: 'Add category' }).click()
  const dup = page.getByRole('alert')
  await dup.waitFor()
  check('a second "TOYS" is refused, naming the category that exists', /"Toys" already exists/.test(await dup.innerText()), await dup.innerText())

  // ---- The product form: a dropdown of active categories
  await page.goto(`${WEB}/admin/products`)
  await page.getByRole('button', { name: '+ Add product' }).click()
  const select = page.getByLabel('Category')
  await select.waitFor()
  check('the category is a dropdown, not a text box', (await select.evaluate((el) => el.tagName)) === 'SELECT')
  await page.locator('#title').fill('Rubber Duck')
  await page.locator('#actualPrice').fill('300')
  await page.locator('#stock').fill('5')
  await select.selectOption({ label: 'Toys' })
  await page.getByRole('button', { name: 'Save' }).click()
  const row = page.getByRole('row').filter({ hasText: 'Rubber Duck' })
  await row.waitFor()
  check('a product saved with its category shows it in the list', /Toys/.test(await row.innerText()))

  // ---- Rename reaches the product; delete is blocked while it has products
  await page.goto(`${WEB}/admin/categories`)
  await page.getByRole('button', { name: 'Rename Toys' }).click()
  await page.getByLabel('New name for Toys').fill('Kids Toys')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('row').filter({ hasText: 'Kids Toys' }).waitFor()
  await page.goto(`${WEB}/admin/products`)
  await page.getByRole('row').filter({ hasText: 'Rubber Duck' }).waitFor()
  check('after a rename, the product shows the new name', /Kids Toys/.test(await page.getByRole('row').filter({ hasText: 'Rubber Duck' }).innerText()))

  await page.goto(`${WEB}/admin/categories`)
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Delete Kids Toys' }).click()
  const blocked = page.getByRole('alert')
  await blocked.waitFor()
  check('deleting a category with products is refused, saying what to do', /another category/.test(await blocked.innerText()), await blocked.innerText())

  // ---- A disabled category is not offered for a new product
  await page.getByRole('button', { name: 'Disable Kids Toys' }).click()
  await page.getByText('Disabled', { exact: true }).waitFor()
  await page.goto(`${WEB}/admin/products`)
  await page.getByRole('button', { name: '+ Add product' }).click()
  await page.getByText('You have no categories yet.').waitFor({ timeout: 15000 })
  check('with its only category disabled, a new product cannot be put in it', true)
} catch (err) {
  check('browser journey', false, err.message.split('\n')[0])
} finally {
  await browser.close()
}
check('no script errors', problems.length === 0, problems[0])
console.log(failures ? `\n${failures} failed` : '\nAll passed')
process.exit(failures ? 1 : 0)
