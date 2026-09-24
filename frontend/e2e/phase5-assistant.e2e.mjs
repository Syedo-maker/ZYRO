// Browser test for Phase 5, Module 3: the AI Shopping Assistant widget on the storefront. Real
// Chromium against the real frontend and backend; the Anthropic API is stood in by
// e2e-server.ts's fake AI provider.
//
// Setup and run: same servers as phase4-ai-content.e2e.mjs (backend e2e-server + Redis, and
// `npm run dev` in the frontend), then:
//   node e2e/phase5-assistant.e2e.mjs
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

// ---- Setup through the API: a store with a mug and a lamp ----
const ownerEmail = `e2e-p5-owner-${suffix}@example.com`
const password = 'password123'
const reg = await api('POST', '/auth/register', { body: { email: ownerEmail, password, storeName: `Aurora ${suffix}`, storeSlug: `e2e-p5-${suffix}` } })
const ownerToken = reg.json.accessToken
const storeId = (await api('GET', '/users/me/stores', { token: ownerToken })).json[0].id
const mug = (await api('POST', `/stores/${storeId}/products`, { token: ownerToken, body: { title: 'Ceramic Mug', price: 12.5, stock: 10, category: 'kitchen' } })).json.id
await api('POST', `/stores/${storeId}/products`, { token: ownerToken, body: { title: 'Desk Lamp', price: 30, stock: 5, category: 'lighting' } })
const S = `${WEB}/store/${storeId}`

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
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `p5-${name}.png`) })
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

await step('the widget is closed by default, on every storefront page', sp, async () => {
  await sp.goto(S)
  await sp.getByRole('heading', { level: 1 }).first().waitFor()
  check('widget: the open button is visible on the home page', await sp.getByRole('button', { name: 'Open shopping assistant' }).isVisible())
  check('widget: the chat panel is not open by default', (await sp.getByRole('dialog', { name: 'Shopping assistant' }).count()) === 0)
  await sp.goto(`${S}/products/${mug}`)
  await sp.getByRole('heading', { level: 1, name: 'Ceramic Mug' }).waitFor()
  check('widget: also present on the product page (shared storefront layout)', await sp.getByRole('button', { name: 'Open shopping assistant' }).isVisible())
})

await step('ask a question, get a reply and a matching product card', sp, async () => {
  await sp.goto(S)
  await sp.getByRole('button', { name: 'Open shopping assistant' }).click()
  const dialog = sp.getByRole('dialog', { name: 'Shopping assistant' })
  await dialog.getByText('Hi! Ask me anything about our products').waitFor()

  await dialog.getByLabel('Your message').fill('Do you have any mugs?')
  await dialog.getByRole('button', { name: 'Send' }).click()
  await dialog.getByText("Yes! Based on what's in stock").waitFor()
  check('assistant: replies with the AI text', true)
  check('assistant: suggests the matching product (mug), not the unrelated lamp', (await dialog.getByRole('link', { name: /Ceramic Mug/ }).count()) === 1 && (await dialog.getByRole('link', { name: /Desk Lamp/ }).count()) === 0)
  check('assistant: the suggested product shows its real price', await dialog.getByText('$12.50').isVisible())
  await shot(sp, 'chat-reply')

  const [productPage] = await Promise.all([sp.waitForURL(`**/products/${mug}`), dialog.getByRole('link', { name: /Ceramic Mug/ }).click()])
  check('assistant: clicking a suggested product opens its real product page', !!productPage || sp.url().endsWith(`/products/${mug}`))
})

await step('the assistant stays quiet about products it has never heard of', sp, async () => {
  await sp.goto(S)
  await sp.getByRole('button', { name: 'Open shopping assistant' }).click()
  const dialog = sp.getByRole('dialog', { name: 'Shopping assistant' })
  await dialog.getByLabel('Your message').fill('Do you sell kayaks?')
  await dialog.getByRole('button', { name: 'Send' }).click()
  await dialog.getByText("Yes! Based on what's in stock").waitFor()
  check('assistant: a question matching nothing in the catalog suggests no products', (await dialog.locator('a').count()) === 0)
  await sp.getByRole('button', { name: 'Close chat' }).click()
  check('widget: closing the panel hides it again', (await sp.getByRole('dialog', { name: 'Shopping assistant' }).count()) === 0)
})

console.log(consoleErrors.length === 0 ? 'PASS  no console errors or uncaught exceptions' : `FAIL  console errors:\n${consoleErrors.join('\n')}`)
if (consoleErrors.length > 0) failures++

await browser.close()
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
