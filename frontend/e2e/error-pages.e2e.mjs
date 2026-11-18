// The 404 page and the error page in a real browser (B2, 2026-11): an unknown address shows a 404 page
// (it used to redirect home) whose button goes to the right home for where the visitor is and who they
// are, valid routes and redirects still work, and a page that fails to load shows the error page with no
// technical detail.
//
// Setup: the backend (npm run dev or the e2e server) and `npm run dev` in frontend, then:
//   node e2e/error-pages.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (emails and slugs use the e2e- prefix).
import { chromium } from 'playwright'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
const suffix = Date.now().toString(36)
let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}
const api = async (method, p, { token, body } = {}) => {
  const res = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: await res.json().catch(() => null) }
}

const email = `e2e-errors-${suffix}@example.com`
const reg = await api('POST', '/auth/register', { body: { email, password: 'password123', storeName: `E2E Errors ${suffix}`, storeSlug: `e2e-errors-${suffix}` } })
const storeId = (await api('GET', '/users/me/stores', { token: reg.json.accessToken })).json[0].id

const browser = await chromium.launch()
try {
  // ---- A visitor
  const visitor = await (await browser.newContext()).newPage()
  await visitor.goto(`${WEB}/no-such-page`)
  await visitor.getByRole('heading', { name: 'Page not found' }).waitFor({ timeout: 15000 })
  check('an unknown address shows the 404 page, and stays at that address (no redirect)', new URL(visitor.url()).pathname === '/no-such-page')
  check('the page shows no technical detail', !/(stack|undefined|TypeError|at \w+ \()/.test(await visitor.locator('main').innerText()))
  await visitor.getByRole('link', { name: 'Go to the home page' }).click()
  await visitor.waitForURL(`${WEB}/`)
  check('a visitor is sent to the landing page', true)

  await visitor.goto(`${WEB}/store/${storeId}/no-such-page`)
  await visitor.getByRole('heading', { name: 'Page not found' }).waitFor({ timeout: 15000 })
  check('inside a shop, the 404 keeps the shop around it', (await visitor.getByRole('link', { name: /^Cart/ }).count()) > 0)
  await visitor.getByRole('link', { name: 'Back to the shop' }).click()
  await visitor.waitForURL(`${WEB}/store/${storeId}`)
  check('and its button goes back to that shop', true)

  await visitor.goto(`${WEB}/shop`)
  await visitor.getByRole('heading', { name: 'Shops on ZYRO', level: 1 }).waitFor({ timeout: 15000 })
  check('a valid route still works', true)

  // ---- A signed-in owner
  const owner = await (await browser.newContext()).newPage()
  await owner.goto(`${WEB}/login`)
  await owner.getByLabel('Email').fill(email)
  await owner.getByLabel('Password').fill('password123')
  await owner.getByRole('button', { name: /^log in$/i }).click()
  await owner.waitForURL('**/admin/**', { timeout: 20000 })
  await owner.goto(`${WEB}/admin`)
  await owner.waitForURL('**/admin/products', { timeout: 15000 })
  check('a redirect (/admin to /admin/products) still works', true)
  await owner.goto(`${WEB}/admin/no-such-page`)
  await owner.getByRole('heading', { name: 'Page not found' }).waitFor({ timeout: 15000 })
  check('an unknown admin address shows the 404 inside the dashboard', (await owner.locator('aside a', { hasText: 'Products' }).count()) === 1)
  await owner.getByRole('link', { name: 'Go to your dashboard' }).click()
  await owner.waitForURL('**/admin/products', { timeout: 15000 })
  check("a signed-in owner's button goes to their dashboard", true)

  // ---- A page that fails to load: its code is blocked, so the page throws while loading
  const broken = await (await browser.newContext()).newPage()
  await broken.route('**/src/pages/legal/TermsPage.tsx*', (route) => route.abort())
  await broken.goto(`${WEB}/terms`)
  await broken.getByRole('heading', { name: 'Something went wrong' }).waitFor({ timeout: 15000 })
  check('a page that fails shows the error page instead of a blank screen', true)
  check('the error page shows no technical detail', !/(TermsPage|import|chunk|stack|Failed to fetch)/i.test(await broken.locator('main').innerText()))
  await broken.getByRole('link', { name: 'Go to the home page' }).click()
  await broken.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 15000 })
  check('its button recovers to the landing page', new URL(broken.url()).pathname === '/')
} catch (err) {
  check('browser journey', false, err.message.split('\n')[0])
} finally {
  await browser.close()
}
console.log(failures ? `\n${failures} failed` : '\nAll passed')
process.exit(failures ? 1 : 0)
