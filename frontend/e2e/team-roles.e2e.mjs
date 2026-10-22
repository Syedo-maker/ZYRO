// Staff roles and the email notice, in a real browser (2026-10-22). The owner adds a cashier on the
// Team page; the cashier sees the catalogue read-only; the owner makes them a Manager from the role
// dropdown, and the same session now has products, stock and the AI tools. While email sending is not
// set up, the Marketing page says so instead of failing silently.
//
// Setup: the backend (npm run dev, without SENDGRID_* in backend/.env) and `npm run dev` in the
// frontend, then:  node e2e/team-roles.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (emails and slugs use the e2e- prefix).
import { chromium } from 'playwright'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
const suffix = Date.now().toString(36)
const ownerEmail = `e2e-roles-${suffix}@example.com`
const staffEmail = `e2e-roles-${suffix}-s@example.com`
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

const reg = await api('POST', '/auth/register', { body: { email: ownerEmail, password: 'password123', storeName: `E2E Roles ${suffix}`, storeSlug: `e2e-roles-${suffix}`, currency: 'PKR' } })
const storeId = (await api('GET', '/users/me/stores', { token: reg.json.accessToken })).json[0].id
await api('POST', `/stores/${storeId}/products`, { token: reg.json.accessToken, body: { title: 'Brass Lamp', actualPrice: 3200, stock: 4, category: 'Home' } })

const browser = await chromium.launch()
async function signIn(email, password) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(e.message))
  await page.goto(`${WEB}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /log in|sign in/i }).click()
  await page.waitForURL('**/admin/**')
  return { page, problems }
}

try {
  // ---- The owner adds a cashier
  const o = await signIn(ownerEmail, 'password123')
  await o.page.goto(`${WEB}/admin/team`)
  check('team: the Manager role says it covers the catalogue and the AI tools', /products, stock, categories and the AI writing tools/.test(await o.page.locator('form').filter({ hasText: 'Add a cashier or manager' }).innerText()))
  await o.page.getByLabel('Email', { exact: true }).fill(staffEmail)
  await o.page.getByLabel(/Starting password/).fill('staff-pass-123')
  await o.page.getByRole('radio', { name: /^Cashier/ }).check()
  await o.page.getByRole('button', { name: 'Add to team' }).click()
  const role = o.page.getByLabel(`Role for ${staffEmail}`)
  await role.waitFor()
  check('team: the new member shows as a cashier', (await role.inputValue()) === 'cashier')

  // ---- The cashier sees the catalogue read-only
  const s = await signIn(staffEmail, 'staff-pass-123')
  await s.page.goto(`${WEB}/admin/products`)
  await s.page.getByRole('row').filter({ hasText: 'Brass Lamp' }).waitFor({ timeout: 15000 })
  check('cashier: no "+ Add product", and a note saying why', (await s.page.getByRole('button', { name: '+ Add product' }).count()) === 0 && (await s.page.getByRole('status').filter({ hasText: 'Products permission' }).count()) === 1)
  check('cashier: the Team page is the owner\'s', /Only the store owner can manage the team/.test(await (await s.page.goto(`${WEB}/admin/team`), s.page.locator('main').innerText())))

  // ---- The owner makes them a manager
  await role.selectOption('manager')
  await o.page.getByText(`${staffEmail} is now a manager.`, { exact: false }).waitFor()
  check('team: the owner changes the role from the dropdown, and it is confirmed', (await role.inputValue()) === 'manager')

  // ---- Same session, next page: the catalogue is theirs now
  await s.page.goto(`${WEB}/admin/products`)
  await s.page.getByRole('button', { name: '+ Add product' }).waitFor({ timeout: 15000 })
  await s.page.getByRole('button', { name: 'Edit Brass Lamp' }).waitFor({ timeout: 15000 })
  check('manager: "+ Add product", Edit and the stock control appear', (await s.page.getByRole('button', { name: 'Edit Brass Lamp' }).count()) === 1 && (await s.page.getByLabel('Stock for Brass Lamp', { exact: true }).count()) === 1)
  check('manager: Categories is in their sidebar', (await s.page.locator('aside a', { hasText: 'Categories' }).count()) === 1)
  await s.page.getByRole('button', { name: 'Edit Brass Lamp' }).click()
  await s.page.getByRole('button', { name: 'Generate description with AI' }).waitFor({ timeout: 15000 })
  check('manager: the AI tools are in the product form', true)
  await s.page.goto(`${WEB}/admin/dashboard`)
  await s.page.getByRole('region', { name: 'AI usage this month' }).waitFor({ timeout: 15000 })
  check('manager: the dashboard shows the store\'s AI allowance', true)
  check('manager: billing stays the owner\'s (not in their sidebar)', (await s.page.locator('aside a', { hasText: 'Plan & billing' }).count()) === 0)

  // ---- Email sending is not set up: the Marketing page says so
  await o.page.goto(`${WEB}/admin/marketing`)
  const notice = o.page.getByRole('status').filter({ hasText: 'Email sending is not set up' })
  await notice.waitFor({ timeout: 15000 })
  check('marketing: "Email sending is not set up", and that no AI allowance is used meanwhile', /Nothing is used from your AI allowance/.test(await notice.innerText()))
  check('no script errors', o.problems.length === 0 && s.problems.length === 0, [...o.problems, ...s.problems][0])
} catch (err) {
  check('browser journey', false, err.message.split('\n')[0])
} finally {
  await browser.close()
}
console.log(failures ? `\n${failures} failed` : '\nAll passed')
process.exit(failures ? 1 : 0)
