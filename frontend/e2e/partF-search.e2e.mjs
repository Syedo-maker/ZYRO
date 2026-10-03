// Browser test for Part F, search. A shop sells a ceramic mug, a steel kettle and leather shoes.
// A shopper searching with a typo ("ceramik") is shown the mug and told what was searched for, with
// a link that really does take them literally; a shopper typing Roman Urdu ("ketli") finds the
// kettle; suggestions appear for a misspelt word; nothing in a shop is ever found from another shop;
// and the page fits a phone.
//
// Setup and run: backend e2e server (npx tsx scripts/e2e-server.ts) and Redis, and `npm run dev`
// in the frontend, then: node e2e/partF-search.e2e.mjs
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

async function shop(tag, products) {
  const email = `e2e-pf-${tag}-${suffix}@example.com`
  const reg = await api('POST', '/auth/register', { body: { email, password, storeName: `Search ${tag} ${suffix}`, storeSlug: `e2e-pf-${tag}-${suffix}`, currency: 'PKR' } })
  const token = reg.json.accessToken
  const storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
  for (const p of products) await api('POST', `/stores/${storeId}/products`, { token, body: { price: 450, stock: 10, ...p } })
  return { email, token, storeId }
}

const A = await shop('a', [
  { title: 'Ceramic Mug', category: 'kitchen', description: 'A sturdy mug for everyday use.' },
  { title: 'Steel Kettle', category: 'kitchen', description: 'Boils water quickly.' },
  { title: 'Leather Shoes', category: 'footwear', description: 'Formal shoes.' },
])
const B = await shop('b', [{ title: 'Ceramic Teapot', category: 'kitchen', description: 'Another shop entirely.' }])

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
    await page.screenshot({ path: path.join(SHOTS, `pf-failure-${name.replace(/\W+/g, '-')}.png`) }).catch(() => undefined)
  }
}

const search = (page, storeId, q, extra = '') => page.goto(`${WEB}/store/${storeId}/products?q=${encodeURIComponent(q)}${extra}`)
const titlesOn = async (page) => (await page.locator('main').innerText()).toString()

const sp = await session('shopper')

await step('an ordinary search', sp, async () => {
  await search(sp, A.storeId, 'ceramic')
  await sp.getByText('Ceramic Mug').first().waitFor()
  check('search: the words typed find the product, with nothing explained away', !/Showing results for/.test(await titlesOn(sp)))
})

await step('a typo', sp, async () => {
  await search(sp, A.storeId, 'ceramik')
  await sp.getByText('Ceramic Mug').first().waitFor()
  const text = await titlesOn(sp)
  check('typo: "ceramik" still finds the mug', /Ceramic Mug/.test(text))
  check('typo: the shopper is told what was searched for instead', /Showing results for\s*ceramic/.test(text.replace(/\s+/g, ' ')))
  check('typo: there is a way back to exactly what was typed', await sp.getByRole('link', { name: /Search for "ceramik" instead/ }).isVisible())
  await sp.screenshot({ path: path.join(SHOTS, 'pf-typo.png'), fullPage: true })
})

await step('taking the shopper literally', sp, async () => {
  await sp.getByRole('link', { name: /Search for "ceramik" instead/ }).click()
  await sp.getByText('Nothing found').waitFor()
  check('literal: asking for the exact words really does take them literally', /ceramik/.test(sp.url()) && /exact=1/.test(sp.url()))
})

await step('Roman Urdu', sp, async () => {
  await search(sp, A.storeId, 'ketli')
  await sp.getByText('Steel Kettle').first().waitFor()
  const text = (await titlesOn(sp)).replace(/\s+/g, ' ')
  check('roman urdu: "ketli" finds the Steel Kettle', /Steel Kettle/.test(text))
  check('roman urdu: the shopper is told it also looked for "kettle"', /Also showing products for\s*kettle/.test(text))
  await sp.screenshot({ path: path.join(SHOTS, 'pf-urdu.png'), fullPage: true })
})

await step('more Roman Urdu', sp, async () => {
  await search(sp, A.storeId, 'joota')
  await sp.getByText('Leather Shoes').first().waitFor()
  check('roman urdu: "joota" finds the Leather Shoes', true)
})

await step('nothing at all', sp, async () => {
  await search(sp, A.storeId, 'zzzqqq')
  await sp.getByText('Nothing found').waitFor()
  check('no match: an empty result is a plain message, not an error', true)
})

await step('suggestions as you type', sp, async () => {
  await sp.goto(`${WEB}/store/${A.storeId}/products`)
  const box = sp.getByRole('searchbox').or(sp.getByPlaceholder(/search/i)).first()
  await box.waitFor()
  await box.fill('ceramik')
  await sp.waitForTimeout(900)
  const body = await sp.locator('body').innerText()
  check('suggest: a misspelt word still suggests the product rather than an empty box', /Ceramic Mug/.test(body))
})

await step('one shop never sees another', sp, async () => {
  await search(sp, A.storeId, 'ceramic')
  check('isolation: this shop never shows the other shop\'s teapot', !/Ceramic Teapot/.test(await titlesOn(sp)))
  await search(sp, B.storeId, 'ceramic')
  await sp.getByText('Ceramic Teapot').first().waitFor()
  check('isolation: the other shop shows only its own', !/Ceramic Mug/.test(await titlesOn(sp)))
  await search(sp, A.storeId, 'teapo')
  check('isolation: a typo is corrected against this shop\'s own words, never another\'s', !/Ceramic Teapot/.test(await titlesOn(sp)))
})

const phone = await session('phone', { width: 375, height: 740 })
await step('phone', phone, async () => {
  await search(phone, A.storeId, 'ceramik')
  await phone.getByText('Ceramic Mug').first().waitFor()
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('phone: the results and the note fit a 375 px screen', overflow <= 0, `overflow ${overflow}px`)
})

console.log(errors.length === 0 ? 'PASS  no console errors' : `FAIL  console errors:\n${errors.join('\n')}`)
if (errors.length) failures++
await browser.close()
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
