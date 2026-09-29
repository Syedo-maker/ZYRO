// Browser test for Part C, the Growth Advisor: the "This week's tip" card on the dashboard. A store
// sells most of a product at the register, so its best seller runs low; "Check now" then writes the
// week's tip (the e2e server's fake AI writes it from the facts it is given, like the real model).
// Then: "Got it" hides it, the owner switches tips off and on, a staff member without the analytics
// permission never sees the card, and the card fits a phone.
//
// Setup and run: backend e2e server (npx tsx scripts/e2e-server.ts) and Redis, and `npm run dev`
// in the frontend, then: node e2e/partC-advisor.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (slugs and emails use the e2e- prefix).
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
const SHOTS = path.join(import.meta.dirname, 'shots')
fs.mkdirSync(SHOTS, { recursive: true })
let failures = 0
const check = (n, ok, x = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`)
  if (!ok) failures++
}
const suffix = Date.now().toString(36)
const password = 'password123'

async function api(method, p, { token, body } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text()
  return { status: res.status, json: t ? JSON.parse(t) : null }
}

// ---- A store whose best seller is nearly sold out ----
const ownerEmail = `e2e-pc-owner-${suffix}@example.com`
const reg = await api('POST', '/auth/register', { body: { email: ownerEmail, password, storeName: `Tips Shop ${suffix}`, storeSlug: `e2e-pc-${suffix}` } })
const token = reg.json.accessToken
const storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
const chai = (await api('POST', `/stores/${storeId}/products`, { token, body: { title: 'Chai Cup', price: 30, stock: 6, category: 'kitchen' } })).json.id
await api('POST', `/stores/${storeId}/pos/shift/open`, { token, body: { openingFloat: 100 } })
for (let i = 0; i < 5; i++) await api('POST', `/stores/${storeId}/pos/sales`, { token, body: { items: [{ productId: chai, quantity: 1 }], payments: [{ method: 'cash', amount: 30 }] } })
const staffEmail = `e2e-pc-staff-${suffix}@example.com`
await api('POST', `/stores/${storeId}/staff`, { token, body: { email: staffEmail, password, permissions: ['pos_sell'] } })

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
  await page.waitForURL('**/admin/**')
}
async function step(name, page, fn) {
  try {
    await fn()
  } catch (e) {
    failures++
    console.log(`FAIL  ${name}  (${String(e.message).split('\n')[0]})  url=${page.url()}`)
    await page.screenshot({ path: path.join(SHOTS, `pc-failure-${name.replace(/\W+/g, '-')}.png`) }).catch(() => undefined)
  }
}

const op = await session('owner')
await login(op, ownerEmail)
const card = op.getByRole('region', { name: 'Growth tips' })

await step('before the first check', op, async () => {
  await op.goto(`${WEB}/admin/dashboard`)
  await card.waitFor()
  check('card: shows on the dashboard, saying where tips come from', await card.getByText("From automated weekly checks on your store's totals").isVisible())
  check('card: before any check this week, it says so and offers Check now', (await card.getByText(/No tip this week yet/).isVisible()) && (await card.getByRole('button', { name: 'Check now' }).isVisible()))
})

await step('check now writes the tip', op, async () => {
  await card.getByRole('button', { name: 'Check now' }).click()
  await card.getByText(/Chai Cup/).waitFor()
  const text = await card.innerText()
  check('tip: names the best seller that is running low, with how many are left', /Chai Cup/.test(text) && /1 left/.test(text), text.slice(0, 160))
  check('tip: gives "Got it" and, for the owner, "Turn off tips"', (await card.getByRole('button', { name: 'Got it' }).isVisible()) && (await card.getByRole('button', { name: 'Turn off tips' }).isVisible()))
  await op.screenshot({ path: path.join(SHOTS, 'pc-tip.png') })
})

await step('got it hides the tip', op, async () => {
  await card.getByRole('button', { name: 'Got it' }).click()
  await card.getByText(/No tip this week yet/).waitFor()
  check('dismiss: the tip is gone after "Got it", and stays gone after a reload', true)
  await op.reload()
  await card.waitFor()
  check('dismiss: still gone after reloading', (await card.getByText(/Chai Cup/).count()) === 0)
})

await step('switching tips off and on', op, async () => {
  await card.getByRole('button', { name: 'Turn off tips' }).click()
  await card.getByText('Weekly growth tips are switched off.').waitFor()
  check('off: the card says tips are off and offers to switch them back on', await card.getByRole('button', { name: 'Switch tips on' }).isVisible())
  check('off: the server agrees', (await api('GET', `/stores/${storeId}/advisor`, { token })).json.enabled === false)
  await card.getByRole('button', { name: 'Switch tips on' }).click()
  await card.getByText(/No tip this week yet/).waitFor()
  check('on: switched back on from the card', (await api('GET', `/stores/${storeId}/advisor`, { token })).json.enabled === true)
})

const sp = await session('staff')
await step('staff without the analytics permission', sp, async () => {
  await login(sp, staffEmail)
  await sp.goto(`${WEB}/admin/dashboard`)
  await sp.getByRole('heading', { name: 'Dashboard' }).waitFor()
  await sp.waitForTimeout(800)
  check('staff: a cashier (no analytics permission) never sees the tips card', (await sp.getByRole('region', { name: 'Growth tips' }).count()) === 0)
})

const phone = await session('phone', { width: 375, height: 740 })
await step('phone', phone, async () => {
  await login(phone, ownerEmail)
  await phone.goto(`${WEB}/admin/dashboard`)
  await phone.getByRole('region', { name: 'Growth tips' }).waitFor()
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('phone: the dashboard with the tips card fits a 375 px screen', overflow <= 0, `overflow ${overflow}px`)
})

console.log(errors.length === 0 ? 'PASS  no console errors' : `FAIL  console errors:\n${errors.join('\n')}`)
if (errors.length) failures++
await browser.close()
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
