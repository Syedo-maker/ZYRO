// Browser test for Part D, the Trend Scout. Five stores in the test market XTS sell clay chai cups
// (15 last week against 5 a week before), and one garden store sells alone. After the week's run:
// a kitchen store's dashboard shows the shared "Market trends" report, each line marked with its
// source and the sources listed; the garden store is told its category is withheld; a cashier never
// sees the card; a platform administrator imports a Google Trends file and sees the week's reports;
// and the pages fit a phone.
//
// Setup and run: backend e2e server (npx tsx scripts/e2e-server.ts) and Redis, and `npm run dev`
// in the frontend, then: node e2e/partD-trends.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (slugs and emails use the e2e- prefix; the
// test market XTS and "e2e ..." categories are removed too).
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
const E2E = 'http://localhost:5000/__e2e'
const SHOTS = path.join(import.meta.dirname, 'shots')
fs.mkdirSync(SHOTS, { recursive: true })
let failures = 0
const check = (n, ok, x = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`)
  if (!ok) failures++
}
const suffix = Date.now().toString(36)
const password = 'password123'
const DAY = 24 * 60 * 60 * 1000

async function api(method, p, { token, body, base = API } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text()
  return { status: res.status, json: t ? JSON.parse(t) : null }
}

async function store(tag, category, title) {
  const email = `e2e-td-${tag}-${suffix}@example.com`
  const reg = await api('POST', '/auth/register', { body: { email, password, storeName: `Trends ${tag} ${suffix}`, storeSlug: `e2e-td-${tag}-${suffix}` } })
  const token = reg.json.accessToken
  const storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
  await api('POST', '/set-currency', { base: E2E, body: { storeId, currency: 'XTS' } })
  const productId = (await api('POST', `/stores/${storeId}/products`, { token, body: { title, price: 10, stock: 100, category } })).json.id
  await api('POST', `/stores/${storeId}/pos/shift/open`, { token, body: { openingFloat: 100 } })
  const sell = async (quantity, at) => {
    const sale = await api('POST', `/stores/${storeId}/pos/sales`, { token, body: { items: [{ productId, quantity }], payments: [{ method: 'cash', amount: 10 * quantity }] } })
    await api('POST', '/backdate-orders', { base: E2E, body: { orderIds: [sale.json.id], at } })
  }
  return { email, token, storeId, sell }
}

// ---- Last week's sales across stores ----
const now = new Date()
const monday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - ((now.getUTCDay() + 6) % 7) * DAY
const lastWeek = new Date(monday - 3 * DAY).toISOString()
const before = new Date(monday - 14 * DAY).toISOString()

const kitchen = []
for (let i = 0; i < 5; i++) {
  const s = await store(`k${i}`, 'Home & Kitchen', 'Clay Chai Cup')
  await s.sell(3, lastWeek)
  await s.sell(4, before)
  kitchen.push(s)
}
const garden = await store('garden', 'Garden', 'Garden Hose')
await garden.sell(5, lastWeek)
await garden.sell(5, before)
const run = await api('POST', '/trends-run', { base: E2E, body: { tenantIds: [...kitchen, garden].map((s) => s.storeId), markets: ['XTS'] } })
check('setup: the week is run: kitchen published, garden withheld', run.json.published === 1 && run.json.suppressed === 1, JSON.stringify(run.json))

const staffEmail = `e2e-td-staff-${suffix}@example.com`
await api('POST', `/stores/${kitchen[0].storeId}/staff`, { token: kitchen[0].token, body: { email: staffEmail, password, permissions: ['pos_sell'] } })
const adminEmail = `e2e-td-admin-${suffix}@example.com`
await api('POST', '/auth/register', { body: { email: adminEmail, password, storeName: `Trends admin ${suffix}`, storeSlug: `e2e-td-admin-${suffix}` } })
await api('POST', '/make-admin', { base: E2E, body: { email: adminEmail } })

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
    await page.screenshot({ path: path.join(SHOTS, `td-failure-${name.replace(/\W+/g, '-')}.png`) }).catch(() => undefined)
  }
}

const op = await session('owner')
await step('kitchen store dashboard', op, async () => {
  await login(op, kitchen[0].email)
  await op.goto(`${WEB}/admin/dashboard`)
  const card = op.getByRole('region', { name: 'Market trends' })
  await card.waitFor()
  const text = await card.innerText()
  check('card: shows the store category, the market and that figures are anonymised', /Home and kitchen/.test(text) && /anonymised totals across XTS stores/.test(text))
  check('card: the report gives the week\'s total across stores and its change (15 units, up 200%)', /sold 15 units/.test(text) && /up 200%/.test(text), text.slice(0, 200))
  check('card: never the exact number of stores, only a band', /5 or more stores/.test(text) && !/\b5 stores\b/.test(text))
  check('card: no other store is named', !/Trends k[1-4]/.test(text))
  check('card: every line is marked with its source number', (await card.locator('li sup').count()) >= (await card.locator('ul > li').count()))
  await card.getByText('Sources').click()
  check('card: the sources list says where each figure comes from and to which date', await card.getByText(/ZYRO sales across stores \(anonymised\), to/).first().isVisible())
  await op.screenshot({ path: path.join(SHOTS, 'td-card.png'), fullPage: true })
})

const gp = await session('garden')
await step('garden store', gp, async () => {
  await login(gp, garden.email)
  await gp.goto(`${WEB}/admin/dashboard`)
  const card = gp.getByRole('region', { name: 'Market trends' })
  await card.getByText(/Not enough stores sell in this category yet/).waitFor()
  check('garden: its category is withheld, with no figures at all', !/units/.test(await card.innerText()))
})

const sp = await session('staff')
await step('cashier', sp, async () => {
  await login(sp, staffEmail)
  await sp.goto(`${WEB}/admin/dashboard`)
  await sp.getByRole('heading', { name: 'Dashboard' }).waitFor()
  await sp.waitForTimeout(800)
  check('staff: a cashier (no analytics permission) never sees the card', (await sp.getByRole('region', { name: 'Market trends' }).count()) === 0)
})

const ap = await session('admin')
await step('platform administrator', ap, async () => {
  await login(ap, adminEmail)
  await ap.goto(`${WEB}/admin/platform`)
  const panel = ap.getByRole('region', { name: 'Trend Scout' })
  await panel.waitFor()
  const row = panel.getByRole('row').filter({ hasText: 'XTS' }).filter({ hasText: 'Home and kitchen' })
  await row.waitFor()
  check('admin: the week\'s reports are listed with status and store count', /Published/.test(await row.innerText()) && /\b5\b/.test(await row.innerText()))
  const csv = 'Category: All categories\n\nWeek,chai cup: (Pakistan)\n' + Array.from({ length: 16 }, (_, i) => `${new Date(monday - (16 - i) * 7 * DAY).toISOString().slice(0, 10)},${i < 12 ? 40 : 60}`).join('\n')
  const form = panel.getByRole('form', { name: 'Import a Google Trends file' })
  await form.getByLabel('Market').selectOption('PKR')
  await form.getByLabel('Category').fill(`e2e chai ${suffix}`)
  await form.getByLabel('CSV file').setInputFiles({ name: 'multiTimeline.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await form.getByRole('button', { name: 'Import' }).click()
  await panel.getByText(/Imported 1 search term \(chai cup\) for PKR \/ e2e chai/).waitFor()
  check('admin: a Google Trends file is imported and read (term, market, normalised category)', true)
  check('admin: the import is listed with its region and last date', await panel.getByText(new RegExp(`PKR / e2e chai ${suffix}`)).last().isVisible())
  await ap.screenshot({ path: path.join(SHOTS, 'td-platform.png'), fullPage: true })
  await form.getByLabel('Category').fill('e2e bad')
  await form.getByLabel('CSV file').setInputFiles({ name: 'notes.csv', mimeType: 'text/csv', buffer: Buffer.from('hello,world\n1,2\n') })
  await form.getByRole('button', { name: 'Import' }).click()
  await panel.getByText(/does not look like a Google Trends/).waitFor()
  check('admin: a file that is not a Google Trends export is refused with a clear reason', true)
})

const phone = await session('phone', { width: 375, height: 740 })
await step('phone', phone, async () => {
  await login(phone, kitchen[1].email)
  await phone.goto(`${WEB}/admin/dashboard`)
  await phone.getByRole('region', { name: 'Market trends' }).waitFor()
  const o1 = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('phone: the dashboard with the trends card fits a 375 px screen', o1 <= 0, `overflow ${o1}px`)
})

console.log(errors.length === 0 ? 'PASS  no console errors' : `FAIL  console errors:\n${errors.join('\n')}`)
if (errors.length) failures++
await browser.close()
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
