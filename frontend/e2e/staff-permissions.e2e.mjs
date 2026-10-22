// What a staff member without the Products permission sees, in a real browser. Before this, a manager
// (the Team page's Manager role has no Products permission) was offered "+ Add product", Edit, the
// stock buttons and every AI writing tool, and each one failed with a 403 they could do nothing about.
// Now the products list is read-only for them, it says why, Categories is not in their sidebar, and the
// dashboard does not ask for AI figures they may not read. The owner still sees everything.
//
// Setup: the backend (npm run dev or the e2e server) and `npm run dev` in the frontend, then:
//   node e2e/staff-permissions.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (emails and slugs use the e2e- prefix).
import { chromium } from 'playwright'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
const suffix = Date.now().toString(36)
const ownerEmail = `e2e-staffperm-${suffix}@example.com`
const managerEmail = `e2e-staffperm-${suffix}-m@example.com`
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

const reg = await api('POST', '/auth/register', { body: { email: ownerEmail, password: 'password123', storeName: `E2E Staff ${suffix}`, storeSlug: `e2e-staffperm-${suffix}`, currency: 'PKR' } })
const token = reg.json.accessToken
const storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
await api('POST', `/stores/${storeId}/products`, { token, body: { title: 'Brass Lamp', actualPrice: 3200, stock: 4, category: 'Home' } })
// The Team page's Manager role.
await api('POST', `/stores/${storeId}/staff`, { token, body: { email: managerEmail, password: 'manager-pass-1', permissions: ['pos_sell', 'refunds', 'discounts_write', 'analytics_read', 'orders_write'] } })

const browser = await chromium.launch()
async function signIn(email, password) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  const refused = []
  const problems = []
  page.on('response', (r) => r.status() === 403 && refused.push(r.url().replace(/.*\/api\/v1/, '')))
  page.on('pageerror', (e) => problems.push(e.message))
  await page.goto(`${WEB}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /log in|sign in/i }).click()
  await page.waitForURL('**/admin/**')
  return { page, refused, problems }
}

try {
  // ---- The manager
  const m = await signIn(managerEmail, 'manager-pass-1')
  await m.page.goto(`${WEB}/admin/products`)
  await m.page.getByRole('row').filter({ hasText: 'Brass Lamp' }).waitFor({ timeout: 15000 })
  check('manager: the products list is shown', true)
  const notice = m.page.getByRole('status').filter({ hasText: 'Products permission' })
  check('manager: it says why products cannot be changed here, and who to ask', (await notice.count()) === 1 && /Ask the store owner/.test(await notice.innerText()))
  check('manager: no "+ Add product", no Edit or Delete', (await m.page.getByRole('button', { name: '+ Add product' }).count()) === 0 && (await m.page.getByRole('button', { name: /^(Edit|Delete) Brass Lamp$/ }).count()) === 0)
  check('manager: stock is shown as a number, without the stock buttons', (await m.page.getByLabel('Stock for Brass Lamp', { exact: true }).count()) === 0 && /\b4\b/.test(await m.page.getByRole('row').filter({ hasText: 'Brass Lamp' }).innerText()))
  check('manager: Categories is not in the sidebar', (await m.page.locator('aside a', { hasText: 'Categories' }).count()) === 0)
  await m.page.goto(`${WEB}/admin/dashboard`)
  await m.page.waitForTimeout(2500)
  check('manager: the dashboard shows no AI meter and asks for no AI figures', (await m.page.getByRole('region', { name: 'AI usage this month' }).count()) === 0 && !m.refused.some((u) => u.includes('/ai-usage')))
  check('manager: nothing the manager was offered was refused by the server', m.refused.length === 0, m.refused.join(', '))
  check('manager: no script errors', m.problems.length === 0, m.problems[0])

  // ---- The owner, for contrast
  const o = await signIn(ownerEmail, 'password123')
  await o.page.goto(`${WEB}/admin/products`)
  await o.page.getByRole('button', { name: 'Edit Brass Lamp' }).waitFor({ timeout: 15000 })
  check('owner: Add, Edit and the stock control are all there', (await o.page.getByRole('button', { name: '+ Add product' }).count()) === 1 && (await o.page.getByLabel('Stock for Brass Lamp', { exact: true }).count()) === 1)
  check('owner: no permission notice', (await o.page.getByRole('status').filter({ hasText: 'Products permission' }).count()) === 0)
  check('owner: Categories is in the sidebar', (await o.page.locator('aside a', { hasText: 'Categories' }).count()) === 1)
  await o.page.getByRole('button', { name: 'Edit Brass Lamp' }).click()
  await o.page.getByRole('button', { name: 'Generate description with AI' }).waitFor({ timeout: 15000 })
  check('owner: the AI tools are in the product form', true)
  await o.page.goto(`${WEB}/admin/dashboard`)
  await o.page.getByRole('region', { name: 'AI usage this month' }).waitFor({ timeout: 15000 })
  check('owner: the dashboard shows the AI meter', true)
} catch (err) {
  check('browser journey', false, err.message.split('\n')[0])
} finally {
  await browser.close()
}
console.log(failures ? `\n${failures} failed` : '\nAll passed')
process.exit(failures ? 1 : 0)
