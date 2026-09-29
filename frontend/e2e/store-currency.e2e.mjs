// Browser test for the store currency: a merchant signs up choosing a currency (Pakistani rupee is
// preselected), prices show in it across the admin, the register and the online store, the owner
// switches it on the Settings page before any sale, it locks after the first sale and the page says
// why, a staff member never sees Settings, and the pages fit a phone.
//
// Setup and run: backend (npx tsx scripts/e2e-server.ts, or npm run dev) and Redis, and `npm run dev`
// in the frontend, then: node e2e/store-currency.e2e.mjs
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
    await page.screenshot({ path: path.join(SHOTS, `cur-failure-${name.replace(/\W+/g, '-')}.png`) }).catch(() => undefined)
  }
}

const ownerEmail = `e2e-cur-owner-${suffix}@example.com`
const op = await session('owner')
let token
let storeId

await step('sign up', op, async () => {
  await op.goto(`${WEB}/register`)
  const select = op.getByLabel('Currency your prices are in')
  check('sign-up: the currency choice starts on the Pakistani rupee', (await select.inputValue()) === 'PKR')
  const labels = await select.locator('option').allInnerTexts()
  check('sign-up: rupees, dollars, pounds and euros are all offered', ['Indian rupee (INR)', 'US dollar (USD)', 'British pound (GBP)', 'Euro (EUR)'].every((l) => labels.includes(l)), `${labels.length} options`)
  await op.getByLabel('Email').fill(ownerEmail)
  await op.getByLabel('Password').fill(password)
  await op.getByLabel('Store name').fill(`Rupee Shop ${suffix}`)
  await op.getByLabel('Store URL').fill(`e2e-cur-${suffix}`)
  await op.getByRole('button', { name: 'Create store' }).click()
  await op.waitForURL('**/admin/**')
  token = (await api('POST', '/auth/login', { body: { email: ownerEmail, password } })).json.accessToken
  storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
  check('sign-up: the new store sells in PKR', (await api('GET', `/stores/${storeId}`)).json.currency === 'PKR')
})

const cup = (await api('POST', `/stores/${storeId}/products`, { token, body: { title: 'Clay Chai Cup', price: 450, stock: 10, category: 'kitchen' } })).json.id
await api('POST', `/stores/${storeId}/products`, { token, body: { title: 'Tea Spoon', price: 99.5, stock: 10, category: 'kitchen' } })

await step('prices in rupees', op, async () => {
  await op.goto(`${WEB}/admin/products`)
  await op.getByText('Clay Chai Cup').first().waitFor()
  const text = await op.locator('main').innerText()
  check('admin: a whole-rupee price shows as Rs 450, not $', /Rs\s?450(?!\.)/.test(text) && !/\$450/.test(text))
  check('admin: a price with paisa keeps them (Rs 99.50), never rounded to Rs 100', /Rs\s?99\.50/.test(text))
  await op.goto(`${WEB}/store/${storeId}/products`)
  await op.getByText('Clay Chai Cup').first().waitFor()
  check('online store: shoppers see Rs 450 too', /Rs\s?450/.test(await op.locator('body').innerText()))
})

await step('settings: switch before any sale', op, async () => {
  await op.goto(`${WEB}/admin/dashboard`)
  await op.getByRole('link', { name: 'Settings' }).click()
  await op.getByRole('heading', { name: 'Settings' }).waitFor()
  const section = op.getByRole('region', { name: 'Currency' })
  check('settings: shows an example price in the current currency', /Rs\s?450/.test(await section.innerText()))
  check('settings: Save is off until a different currency is picked', await section.getByRole('button', { name: 'Save currency' }).isDisabled())
  await section.getByLabel('Currency').selectOption('INR')
  await section.getByRole('button', { name: 'Save currency' }).click()
  await op.getByText('Prices in your store are now shown in Indian rupee.').waitFor()
  check('settings: switched to INR, and the server agrees', (await api('GET', `/stores/${storeId}`)).json.currency === 'INR')
  await op.screenshot({ path: path.join(SHOTS, 'cur-settings.png') })
  await op.goto(`${WEB}/admin/products`)
  await op.getByText('Clay Chai Cup').first().waitFor()
  check('admin: product prices follow the new currency (₹450)', /₹\s?450/.test(await op.locator('main').innerText()))
  await api('PATCH', `/stores/${storeId}/currency`, { token, body: { currency: 'PKR' } })
})

await step('locked after the first sale', op, async () => {
  await api('POST', `/stores/${storeId}/pos/shift/open`, { token, body: { openingFloat: 1000 } })
  const sale = await api('POST', `/stores/${storeId}/pos/sales`, { token, body: { items: [{ productId: cup, quantity: 1 }], payments: [{ method: 'cash', amount: 450 }] } })
  check('register: the sale is recorded in PKR', sale.status === 201 && sale.json.currency === 'PKR')
  await op.goto(`${WEB}/admin/settings`)
  const section = op.getByRole('region', { name: 'Currency' })
  await section.getByText(/cannot be changed after the store's first sale/).waitFor()
  check('settings: after a sale there is no dropdown, and it says why', (await section.getByLabel('Currency').count()) === 0 && (await section.getByText('Pakistani rupee (PKR)').isVisible()))
})

const staffEmail = `e2e-cur-staff-${suffix}@example.com`
await api('POST', `/stores/${storeId}/staff`, { token, body: { email: staffEmail, password, permissions: ['products_write'] } })
const sp = await session('staff')
await step('staff', sp, async () => {
  await login(sp, staffEmail)
  await sp.getByRole('link', { name: 'Products' }).waitFor()
  check('staff: Settings is not in the menu', (await sp.getByRole('link', { name: 'Settings' }).count()) === 0)
  await sp.goto(`${WEB}/admin/settings`)
  await sp.getByText("Only the store owner can change the store's settings.").waitFor()
  check('staff: opening the page directly says only the owner can change settings, with no currency control', (await sp.getByLabel('Currency').count()) === 0)
})

const phone = await session('phone', { width: 375, height: 740 })
await step('phone', phone, async () => {
  await phone.goto(`${WEB}/register`)
  await phone.getByLabel('Currency your prices are in').waitFor()
  const o1 = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  await login(phone, ownerEmail)
  await phone.goto(`${WEB}/admin/settings`)
  await phone.getByRole('heading', { name: 'Settings' }).waitFor()
  const o2 = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('phone: sign-up and Settings both fit a 375 px screen', o1 <= 0 && o2 <= 0, `overflow ${o1}px / ${o2}px`)
})

console.log(errors.length === 0 ? 'PASS  no console errors' : `FAIL  console errors:\n${errors.join('\n')}`)
if (errors.length) failures++
await browser.close()
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
