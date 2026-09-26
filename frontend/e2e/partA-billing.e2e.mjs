// Browser test for Part A, the revenue model: the Plan and billing page (Free, choosing Pro, the
// wait for Stripe's confirmation, an AI pack), the dashboard meter with plan and credits, upgrade
// prompts in place of errors (staff limit, report window), the Platform page (super admins only, no
// emails) and the billing page at phone width. Stripe is stood in by the e2e server: its fake
// payment page, and POST /__e2e/billing which plays Stripe's webhook through the real handler.
//
// Setup and run: backend e2e server (npx tsx scripts/e2e-server.ts) and Redis, and `npm run dev`
// in the frontend, then: node e2e/partA-billing.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (slugs and emails use the e2e- prefix).
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
const ROOT = 'http://localhost:5000'
const SHOTS = path.join(import.meta.dirname, 'shots')
fs.mkdirSync(SHOTS, { recursive: true })
let failures = 0
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); if (!ok) failures++ }
const suffix = Date.now().toString(36)
const password = 'password123'
async function api(method, p, { token, body } = {}) {
  const res = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); return { status: res.status, json: t ? JSON.parse(t) : null }
}
async function owner(tag) {
  const email = `e2e-pa-${tag}-${suffix}@example.com`
  const reg = await api('POST', '/auth/register', { body: { email, password, storeName: `Plans ${tag} ${suffix}`, storeSlug: `e2e-pa-${tag}-${suffix}` } })
  const storeId = (await api('GET', '/users/me/stores', { token: reg.json.accessToken })).json[0].id
  return { email, token: reg.json.accessToken, storeId }
}
const A = await owner('a')
const B = await owner('b')

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
  await page.waitForURL('**/admin/products')
}
const shot = (p, n) => p.screenshot({ path: path.join(SHOTS, `pa-${n}.png`) })
const fake = (body) => fetch(`${ROOT}/__e2e/billing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())

const pa = await session('A')
await login(pa, A.email)

// ---- the billing page on Free ----
await pa.getByRole('link', { name: 'Plan & billing' }).click()
await pa.getByRole('heading', { name: 'Plan and billing' }).waitFor()
await pa.getByRole('heading', { name: 'Free plan' }).waitFor()
check('billing: a new store sees its Free plan, three plans and two AI packs', (await pa.getByRole('region', { name: /^(Free|Pro|Business) plan$/ }).count()) === 3 && (await pa.getByRole('button', { name: /^Buy for/ }).count()) === 2)
check('billing: usage bars for products, staff and both AI allowances', (await pa.getByRole('progressbar').count()) === 4)
check('billing: on Free the paid plans offer Choose, and the current one says Your plan', (await pa.getByRole('button', { name: 'Choose Pro' }).isEnabled()) && (await pa.getByRole('button', { name: 'Your plan' }).isDisabled()))
await pa.screenshot({ path: path.join(SHOTS, 'pa-billing-free.png'), fullPage: true })

// ---- buy Pro (fake Stripe): the plan changes only after the fake webhook ----
await pa.getByRole('button', { name: 'Choose Pro' }).click()
await pa.waitForURL('**/__fake-stripe/**')
check('billing: Choose Pro sends the browser to the payment page', pa.url().includes('/__fake-stripe/'))
await pa.goto(`${WEB}/admin/billing?checkout=success`)
await pa.getByText('Payment received. Confirming with Stripe').waitFor()
await new Promise((r) => setTimeout(r, 3500))
check('billing: before Stripe confirms, the plan is still Free (the return page alone changes nothing)', (await pa.getByRole('heading', { name: 'Free plan' }).count()) === 1)
console.log('fake webhook ->', JSON.stringify(await fake({ storeId: A.storeId, kind: 'subscription', plan: 'PRO' })))
await pa.getByText('You are now on the Pro plan.').waitFor({ timeout: 15000 })
check('billing: once Stripe confirms, the page says so and shows the Pro plan as active', (await pa.getByRole('heading', { name: 'Pro plan', exact: true }).count()) >= 1 && (await pa.getByText('Active', { exact: true }).isVisible()))
check('billing: a paid store can manage its subscription and no longer gets Choose buttons', (await pa.getByRole('button', { name: 'Manage subscription' }).isVisible()) && (await pa.getByRole('button', { name: /^Choose/ }).count()) === 0)
await pa.screenshot({ path: path.join(SHOTS, 'pa-billing-pro.png'), fullPage: true })

// ---- AI pack ----
await pa.getByRole('button', { name: /^Buy for \$5/ }).click()
await pa.waitForURL('**/__fake-stripe/**')
await fake({ storeId: A.storeId, kind: 'topup', pack: 'small' })
await pa.goto(`${WEB}/admin/billing?topup=success`)
await pa.getByText('Your AI credits were added.').waitFor({ timeout: 15000 }).catch(() => undefined)
check('billing: a bought AI pack shows its credits', await pa.getByText(/You have 100 generations and 300 replies left/).isVisible())

// ---- the dashboard meter now shows plan and credits ----
await pa.goto(`${WEB}/admin/dashboard`)
const meter = pa.getByRole('region', { name: 'AI usage this month' })
await meter.waitFor()
check('dashboard: the AI meter names the plan, shows the bigger allowance and the bought credits', (await meter.getByText('Pro plan').isVisible()) && (await meter.getByRole('progressbar', { name: 'AI content generations' }).getAttribute('aria-valuemax')) === '200' && (await meter.getByText(/Bought credits left: 100 generations, 300 replies/).isVisible()))

// ---- limits on a Free store: staff, products, analytics window ----
const pb = await session('B')
await login(pb, B.email)
for (const n of [1, 2]) await api('POST', `/stores/${B.storeId}/staff`, { token: B.token, body: { email: `e2e-pa-st${n}-${suffix}@example.com`, password, permissions: ['orders_write'] } })
await pb.goto(`${WEB}/admin/team`)
await pb.getByRole('heading', { name: 'Team and register' }).waitFor()
await pb.getByLabel('Email', { exact: true }).fill(`e2e-pa-st3-${suffix}@example.com`)
await pb.getByLabel('Starting password', { exact: false }).fill(password)
await pb.getByRole('button', { name: 'Add to team' }).click()
await pb.getByText(/The Free plan includes 2 staff accounts/).waitFor()
check('team: a third staff member on Free shows the limit and an upgrade link, not a bare error', (await pb.getByRole('link', { name: 'Upgrade to Pro' }).isVisible()))
await shot(pb, 'staff-limit')
await pb.getByRole('link', { name: 'Upgrade to Pro' }).click()
await pb.waitForURL('**/admin/billing')
await pb.getByRole('heading', { name: 'Plan and billing' }).waitFor()
check('team: the upgrade link opens the billing page', await pb.getByRole('heading', { name: 'Plan and billing' }).isVisible())

await pb.goto(`${WEB}/admin/dashboard`)
await pb.getByRole('button', { name: '90 days' }).click()
await pb.getByText(/can report on up to 30 days at a time/).waitFor()
check('dashboard: a 90 day report on Free explains the limit, offers Pro, and falls back to 30 days', (await pb.getByRole('link', { name: 'Upgrade to Pro' }).isVisible()) && (await pb.getByRole('button', { name: '30 days' }).getAttribute('aria-pressed')) === 'true')
await shot(pb, 'analytics-limit')

// ---- platform view: only for a super admin ----
check('platform: an ordinary owner has no Platform link', (await pa.getByRole('link', { name: 'Platform' }).count()) === 0)
execSync(`npx tsx scripts/make-super-admin.ts ${A.email}`, { cwd: path.resolve(import.meta.dirname, '../../backend'), stdio: 'ignore' })
await pa.getByRole('button', { name: 'Log out' }).click()
await login(pa, A.email)
await pa.getByRole('link', { name: 'Platform' }).click()
await pa.getByRole('heading', { name: 'Platform', exact: true }).waitFor()
await pa.getByRole('region', { name: 'Platform totals' }).waitFor()
await pa.getByRole('row', { name: new RegExp(`Plans a ${suffix}`) }).waitFor()
check('platform: a super admin sees totals, the economics table and the stores list with per-store plan', (await pa.getByRole('region', { name: 'Plan economics' }).isVisible()) && (await pa.getByRole('row', { name: new RegExp(`Plans a ${suffix}.*Pro`) }).count()) === 1)
check('platform: no emails appear anywhere on the platform page', !(await pa.locator('main').innerText()).includes('@'))
await pa.screenshot({ path: path.join(SHOTS, 'pa-platform.png'), fullPage: true })

// ---- phone ----
const ph = await session('phone', { width: 375, height: 800 })
await login(ph, B.email)
await ph.goto(`${WEB}/admin/billing`)
await ph.getByRole('heading', { name: 'Plan and billing' }).waitFor()
const overflow = await ph.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
check('phone: billing page fits a 375px screen', overflow <= 0, `overflow ${overflow}px`)

console.log(errors.length === 0 ? 'PASS  no console errors' : `FAIL  console errors:\n${errors.join('\n')}`)
if (errors.length) failures++
await browser.close()
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
