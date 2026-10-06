// Browser test for the two fixes:
//
// Issue 2: a visitor is asked whether they want to shop or open a store; "/" no longer dumps
// everybody on the merchant dashboard. A shopper who signs in lands on the shop directory and
// cannot reach the admin pages; an owner lands on their dashboard and can cross to the shopper side
// and back. The directory lists shops that opted in and have a real catalogue, shows only public
// information, and the owner can opt out from Settings.
//
// Issue 1: on the Add product form the merchant chooses "Write it myself" or "Write with AI", gets
// four suggestions built around real popular searches with the keywords each one uses named
// underneath, and nothing is saved until they pick one and save the product.
//
// Setup and run: backend (npx tsx scripts/e2e-server.ts) and Redis, and `npm run dev` in the
// frontend, then: node e2e/roles-and-ideas.e2e.mjs
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
async function step(name, page, fn) {
  try {
    await fn()
  } catch (e) {
    failures++
    console.log(`FAIL  ${name}  (${String(e.message).split('\n')[0]})  url=${page.url()}`)
    await page.screenshot({ path: path.join(SHOTS, `roles-failure-${name.replace(/\W+/g, '-')}.png`) }).catch(() => undefined)
  }
}

// ---- A shop with a real catalogue, set up through the API so the browser test is about the UI ----

const ownerEmail = `e2e-roles-owner-${suffix}@example.com`
const shopperEmail = `e2e-roles-shopper-${suffix}@example.com`

const reg = await api('POST', '/auth/register', {
  body: { email: ownerEmail, password, storeName: `E2E Roles ${suffix}`, storeSlug: `e2e-roles-${suffix}`, currency: 'PKR' },
})
if (reg.status !== 201) {
  console.log('FAIL  setup: could not create the shop', JSON.stringify(reg.json))
  process.exit(1)
}
const ownerToken = reg.json.accessToken
const storeId = (await api('GET', '/users/me/stores', { token: ownerToken })).json[0].id
for (const title of ['Lawn Suit Three Piece', 'Summer Lawn Kurta', 'Cotton Shalwar']) {
  await api('POST', `/stores/${storeId}/products`, { token: ownerToken, body: { title, price: 1800, stock: 10, category: 'clothing' } })
}
await api('PATCH', `/stores/${storeId}/branding`, { token: ownerToken, body: { description: 'Lawn and cotton stitched in Faisalabad.' } })
await api('POST', '/auth/register-customer', { body: { email: shopperEmail, password } })

// ---- Issue 2: the landing screen -----------------------------------------------------------------

const visitor = await session('visitor')

await step('landing screen', visitor, async () => {
  await visitor.goto(WEB)
  await visitor.waitForLoadState('networkidle')
  check('a new visitor is asked what they want to do, not sent to the dashboard', !visitor.url().includes('/admin'), visitor.url())
  check('both choices are offered', await visitor.getByRole('heading', { name: 'Shop', exact: true }).isVisible())
  check('and so is opening a store', await visitor.getByRole('heading', { name: 'Start a store' }).isVisible())
  await visitor.screenshot({ path: path.join(SHOTS, 'roles-landing.png') })
})

await step('choosing to shop', visitor, async () => {
  await visitor.getByRole('button', { name: 'Start shopping' }).click()
  await visitor.waitForURL('**/shop')
  check('choosing to shop opens the shop directory', visitor.url().endsWith('/shop'))
  const card = visitor.getByRole('listitem').filter({ hasText: `E2E Roles ${suffix}` })
  await card.waitFor({ timeout: 15000 })
  check('a shop with a real catalogue is listed', await card.isVisible())
  check("the shop's own line about itself is shown", (await card.innerText()).includes('Lawn and cotton stitched in Faisalabad.'))
  check('the card shows how many products the shop has', /3 products/.test(await card.innerText()))
  check('no price, order or revenue figure is shown on a directory card', !/Rs|revenue|order/i.test(await card.innerText()))
  await visitor.screenshot({ path: path.join(SHOTS, 'roles-directory.png') })
})

await step('the directory remembers the choice', visitor, async () => {
  await visitor.goto(WEB)
  await visitor.waitForLoadState('networkidle')
  // Not signed in, so the landing screen is shown again; the choice is remembered for the next step.
  check('"/" never redirects a visitor into the admin pages', !visitor.url().includes('/admin'), visitor.url())
})

await step('opening a shop from the directory', visitor, async () => {
  await visitor.goto(`${WEB}/shop`)
  await visitor.getByRole('listitem').filter({ hasText: `E2E Roles ${suffix}` }).getByRole('link', { name: 'Visit shop' }).click()
  await visitor.waitForURL(`**/store/${storeId}`)
  check("opening a shop lands on that shop's own storefront", visitor.url().includes(`/store/${storeId}`))
  const back = visitor.getByRole('link', { name: 'All shops' })
  await back.waitFor({ timeout: 15000 })
  check('and there is a way back to all the shops', await back.isVisible())
})

// ---- Issue 2: a signed-in shopper never sees the merchant side ----------------------------------

const shopper = await session('shopper')

await step('a shopper logs in', shopper, async () => {
  await shopper.goto(`${WEB}/login`)
  await shopper.getByLabel('Email').fill(shopperEmail)
  await shopper.getByLabel('Password').fill(password)
  await shopper.getByRole('button', { name: 'Log in' }).click()
  await shopper.waitForURL('**/shop')
  check('a shopper who logs in lands on the shop directory, not a dashboard', shopper.url().endsWith('/shop'))
})

await step('a shopper typing the admin address in', shopper, async () => {
  await shopper.goto(`${WEB}/admin/products`)
  await shopper.waitForURL('**/shop')
  check('a shopper who types the admin address is sent back to the shopper side', shopper.url().endsWith('/shop'))
  const refused = await shopper.evaluate(async (id) => {
    const res = await fetch(`http://localhost:5000/api/v1/stores/${id}/orders`, { credentials: 'include' })
    return res.status
  }, storeId)
  check("and the server refuses the shop's data even when asked for directly", refused === 401 || refused === 403, String(refused))
})

// ---- Issue 2: the owner's side, and the way across ----------------------------------------------

const op = await session('owner')

await step('the owner logs in', op, async () => {
  await op.goto(`${WEB}/login`)
  await op.getByLabel('Email').fill(ownerEmail)
  await op.getByLabel('Password').fill(password)
  await op.getByRole('button', { name: 'Log in' }).click()
  await op.waitForURL('**/admin/**')
  check('an owner who logs in lands on their dashboard', op.url().includes('/admin'))
  check('the owner can cross to the shopper side', await op.getByRole('link', { name: 'Browse shops' }).isVisible())
})

await step('the owner opts out of the directory', op, async () => {
  await op.goto(`${WEB}/admin/settings`)
  const box = op.getByLabel('List my store in the public directory')
  check('the directory setting is on by default', await box.isChecked())
  check('the owner is told their shop is listed', /listed now/i.test(await op.getByRole('region', { name: 'Public directory' }).innerText()))
  await box.uncheck()
  await op.getByRole('region', { name: 'Public directory' }).getByRole('button', { name: 'Save' }).click()
  await op.getByText('Your directory settings are saved.').waitFor()
  await op.screenshot({ path: path.join(SHOTS, 'roles-directory-setting.png') })

  await visitor.goto(`${WEB}/shop`)
  await visitor.waitForLoadState('networkidle')
  check('an opted-out shop is gone from the directory', !(await visitor.getByRole('listitem').filter({ hasText: `E2E Roles ${suffix}` }).isVisible()))
  check('while its own storefront still works for anyone with the link', (await api('GET', `/stores/${storeId}`)).status === 200)

  await op.getByLabel('List my store in the public directory').check()
  await op.getByRole('region', { name: 'Public directory' }).getByRole('button', { name: 'Save' }).click()
  await op.getByText('Your directory settings are saved.').waitFor()
})

// ---- Issue 1: Write with AI ----------------------------------------------------------------------

await step('the add product form offers a choice', op, async () => {
  await op.goto(`${WEB}/admin/products`)
  await op.getByRole('button', { name: 'Add product' }).first().click()
  check('the merchant is offered writing it themselves', await op.getByRole('button', { name: 'Write it myself' }).isVisible())
  check('or writing it with AI', await op.getByRole('button', { name: 'Write with AI' }).isVisible())
  check('writing it themselves is what the form starts on', (await op.getByRole('button', { name: 'Write it myself' }).getAttribute('aria-pressed')) === 'true')
})

await step('asking the AI for suggestions', op, async () => {
  await op.getByLabel('Category', { exact: true }).fill('clothing')
  await op.getByRole('button', { name: 'Write with AI' }).click()
  const suggest = op.getByRole('button', { name: /Suggest 4 options/ })
  check('the button says plainly that it costs one generation', /uses 1 generation/.test(await suggest.innerText()))
  await suggest.click()
  await op.getByRole('listitem').filter({ hasText: 'Use this' }).first().waitFor({ timeout: 60000 })
  const cards = op.getByRole('listitem').filter({ hasText: 'Use this' })
  const count = await cards.count()
  check('several suggestions come back from one press', count >= 2 && count <= 4, String(count))
  const firstCard = cards.first()
  const text = await firstCard.innerText()
  check('a suggestion has a title and a description', text.split('\n').filter((l) => l.trim()).length >= 2)
  check('nothing is saved until the merchant saves the product', /Nothing is saved until you save the product/i.test(await op.getByRole('region', { name: /Name and describe/ }).innerText()))
  await op.screenshot({ path: path.join(SHOTS, 'roles-write-with-ai.png') })

  await firstCard.getByRole('button', { name: 'Use this' }).click()
  const title = await op.getByLabel('Title', { exact: true }).inputValue()
  check('picking a suggestion fills in the title', title.length > 0, title)
  check('and the description', (await op.getByLabel('Description', { exact: true }).inputValue()).length > 0)
})

await step('the merchant can still write it themselves', op, async () => {
  await op.getByRole('button', { name: 'Write it myself' }).click()
  await op.getByLabel('Title', { exact: true }).fill(`Hand Written ${suffix}`)
  check('the title field takes their own words', (await op.getByLabel('Title', { exact: true }).inputValue()) === `Hand Written ${suffix}`)
})

await step('the AI panel on a phone', op, async () => {
  const phone = await session('phone', { width: 390, height: 844 })
  await phone.goto(`${WEB}/login`)
  await phone.getByLabel('Email').fill(ownerEmail)
  await phone.getByLabel('Password').fill(password)
  await phone.getByRole('button', { name: 'Log in' }).click()
  await phone.waitForURL('**/admin/**')
  await phone.goto(`${WEB}/admin/products`)
  await phone.getByRole('button', { name: 'Add product' }).first().click()
  await phone.getByRole('button', { name: 'Write with AI' }).click()
  const wide = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  check('the add product form does not scroll sideways on a phone', !wide)
  await phone.screenshot({ path: path.join(SHOTS, 'roles-phone.png') })
  await phone.goto(`${WEB}/shop`)
  await phone.waitForLoadState('networkidle')
  const wideShop = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  check('the shop directory does not scroll sideways on a phone', !wideShop)
  await phone.screenshot({ path: path.join(SHOTS, 'roles-phone-directory.png') })
})

check('no unexpected console or page errors', errors.length === 0, errors.join(' | '))

await browser.close()
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
