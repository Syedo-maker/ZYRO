// Browser test for Phase 6: "products like this one" on the product page and "Recommended for you" on
// the storefront home. Real Chromium against the real frontend and backend; the Python service is
// stood in by e2e-server.ts's fake recommendation client (same category first), because what this
// checks is what the UI does with the answer. The real ranking is backend/scripts/verify-recommendations.ts.
//
// Setup and run: same servers as phase4-ai-content.e2e.mjs (backend e2e-server + Redis, and
// `npm run dev` in the frontend), then:
//   node e2e/phase6-recommendations.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (slugs and emails use the e2e- prefix).
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
const SHOTS = path.join(import.meta.dirname, 'shots')
fs.mkdirSync(SHOTS, { recursive: true })

let failures = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
  if (!ok) failures++
}
const suffix = Date.now().toString(36)

async function api(method, p, { token, body } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}

async function makeStore(tag, products) {
  const reg = await api('POST', '/auth/register', {
    body: { email: `e2e-p6-${tag}-${suffix}@example.com`, password: 'password123', storeName: `Reco ${tag} ${suffix}`, storeSlug: `e2e-p6-${tag}-${suffix}` },
  })
  const token = reg.json.accessToken
  const storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
  const ids = {}
  for (const p of products) {
    ids[p.title] = (await api('POST', `/stores/${storeId}/products`, { token, body: p })).json.id
  }
  return { storeId, ids }
}

// ---- Setup through the API ----
const main = await makeStore('main', [
  { title: 'Ceramic Mug', price: 12.5, stock: 10, category: 'kitchen' },
  { title: 'Espresso Cup', price: 9, stock: 10, category: 'kitchen' },
  { title: 'Desk Lamp', price: 30, stock: 5, category: 'lighting' },
  { title: 'Sold Out Vase', price: 20, stock: 0, category: 'kitchen' },
])
const lonely = await makeStore('lonely', [{ title: 'Only Product', price: 5, stock: 3, category: 'misc' }])
const S = `${WEB}/store/${main.storeId}`

const browser = await chromium.launch()
const consoleErrors = []
const expected = /Failed to load resource: the server responded with a status of (400|401|403|404|409)/
async function session(label, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'en-US', viewport })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && !expected.test(m.text()) && consoleErrors.push(`${label}: ${m.text()}`))
  page.on('pageerror', (e) => consoleErrors.push(`${label} pageerror ${e.message}`))
  return { ctx, page }
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `p6-${name}.png`) })
async function step(name, page, fn) {
  try {
    await fn()
  } catch (e) {
    failures++
    const shown = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 260)).catch(() => '')
    console.log(`FAIL  ${name}  (${String(e.message).split('\n').slice(0, 3).join(' | ')})  url=${page.url()}  page="${shown}"`)
    await shot(page, `failure-${name.replace(/\W+/g, '-')}`).catch(() => undefined)
  }
}

const shopper = await session('shopper')
const sp = shopper.page

await step('a first-time visitor sees no recommendations on the home page', sp, async () => {
  await sp.goto(S)
  await sp.getByRole('heading', { level: 1 }).first().waitFor()
  await sp.getByRole('heading', { name: 'New arrivals' }).waitFor()
  // Give a wrongly-rendered section time to show up before asserting it is absent.
  await sp.waitForTimeout(700)
  check('home: no "Recommended for you" before the shopper has opened any product', (await sp.getByRole('heading', { name: 'Recommended for you' }).count()) === 0)
})

await step('the product page shows similar, in-stock products', sp, async () => {
  await sp.goto(`${S}/products/${main.ids['Ceramic Mug']}`)
  await sp.getByRole('heading', { level: 1, name: 'Ceramic Mug' }).waitFor()
  const section = sp.getByRole('region', { name: 'You might also like' })
  await section.waitFor()
  const titles = await section.getByRole('heading', { level: 3 }).allInnerTexts()
  check('product page: shows a "You might also like" section', titles.length > 0)
  check('product page: the closest match (same category) comes first', titles[0] === 'Espresso Cup', JSON.stringify(titles))
  check('product page: other in-stock products follow', titles.includes('Desk Lamp'))
  check('product page: never recommends the product being viewed', !titles.includes('Ceramic Mug'))
  check('product page: never recommends a sold-out product', !titles.includes('Sold Out Vase'))
  check('product page: recommended products show their real price', await section.getByText('$9.00').isVisible())
  await shot(sp, 'product-page')

  await section.getByRole('button', { name: 'Add to cart' }).first().click()
  await sp.getByText('Espresso Cup added to your cart.').waitFor()
  check('product page: a recommended product can be added to the cart straight from the row', true)

  await Promise.all([sp.waitForURL(`**/products/${main.ids['Espresso Cup']}`), section.getByRole('link', { name: /Espresso Cup/ }).click()])
  await sp.getByRole('heading', { level: 1, name: 'Espresso Cup' }).waitFor()
  const nextSection = sp.getByRole('region', { name: 'You might also like' })
  // The row disappears while the new product's recommendations load, then comes back: wait for it.
  await nextSection.getByRole('heading', { level: 3, name: 'Ceramic Mug' }).waitFor()
  const next = await nextSection.getByRole('heading', { level: 3 }).allInnerTexts()
  check('product page: opening a recommendation loads its own recommendations, not the old ones', next.includes('Ceramic Mug') && !next.includes('Espresso Cup'), JSON.stringify(next))
})

await step('the home page now recommends from the last product viewed', sp, async () => {
  await sp.goto(S)
  const section = sp.getByRole('region', { name: 'Recommended for you' })
  await section.waitFor()
  const titles = await section.getByRole('heading', { level: 3 }).allInnerTexts()
  check('home: "Recommended for you" appears after a product was viewed', titles.length > 0)
  check('home: it is based on the last viewed product (Espresso Cup), so it recommends the mug and not the cup itself', titles.includes('Ceramic Mug') && !titles.includes('Espresso Cup'), JSON.stringify(titles))
  await shot(sp, 'home')
})

await step('a store with a single product shows no empty recommendations box', sp, async () => {
  await sp.goto(`${WEB}/store/${lonely.storeId}/products/${lonely.ids['Only Product']}`)
  await sp.getByRole('heading', { level: 1, name: 'Only Product' }).waitFor()
  await sp.getByRole('heading', { name: 'Reviews' }).first().waitFor()
  await sp.waitForTimeout(700)
  check('single product: no "You might also like" section at all', (await sp.getByRole('heading', { name: 'You might also like' }).count()) === 0)
})

const phone = await session('phone', { width: 375, height: 800 })
await step('on a phone the row fits the screen', phone.page, async () => {
  await phone.page.goto(`${S}/products/${main.ids['Ceramic Mug']}`)
  await phone.page.getByRole('region', { name: 'You might also like' }).waitFor()
  const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('phone: no horizontal scrolling with the recommendations row', overflow <= 0, `overflow ${overflow}px`)
  await shot(phone.page, 'phone')
})

console.log(consoleErrors.length === 0 ? 'PASS  no console errors or uncaught exceptions' : `FAIL  console errors:\n${consoleErrors.join('\n')}`)
if (consoleErrors.length > 0) failures++

await browser.close()
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
