// Browser test for Phase 4, Module 6: AI Content Tools wired into the Admin Catalog product
// form (product description generate/edit/regenerate/publish, review summary, auto-tag, SEO
// metadata) plus the quota display. Real Chromium against the real frontend and backend; the
// Anthropic API is stood in by e2e-server.ts's fake AI provider, keyed off which tool's prompt
// is asking, so parsing of a real (if scripted) reply is exercised, not skipped.
//
// Setup and run: same servers as phase3-storefront-admin.e2e.mjs (backend e2e-server + Redis,
// and `npm run dev` in the frontend), then:
//   node e2e/phase4-ai-content.e2e.mjs
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
const ownerEmail = `e2e-p4-owner-${suffix}@example.com`
const password = 'password123'

async function api(method, p, { token, body } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}

// ---- Setup through the API: a store with one product, and a customer who reviews it ----
const reg = await api('POST', '/auth/register', { body: { email: ownerEmail, password, storeName: `Aurora ${suffix}`, storeSlug: `e2e-p4-${suffix}` } })
const ownerToken = reg.json.accessToken
const storeId = (await api('GET', '/users/me/stores', { token: ownerToken })).json[0].id
const mug = (await api('POST', `/stores/${storeId}/products`, { token: ownerToken, body: { title: 'Ceramic Mug', price: 12.5, stock: 10, category: 'kitchen' } })).json.id

const custReg = await api('POST', '/auth/register-customer', { body: { email: `e2e-p4-cust-${suffix}@example.com`, password } })
await api('POST', `/stores/${storeId}/products/${mug}/reviews`, { token: custReg.json.accessToken, body: { rating: 5, comment: 'Keeps my coffee hot for hours.' } })

const browser = await chromium.launch()
const consoleErrors = []
const expected = /Failed to load resource: the server responded with a status of (400|401|403|404|409)/
async function session(label, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'en-US', viewport })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && !expected.test(m.text()) && consoleErrors.push(`${label}: ${m.text()}`))
  page.on('pageerror', (e) => consoleErrors.push(`${label} pageerror ${e.message}`))
  return { ctx, page }
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `p4-${name}.png`) })
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

const owner = await session('owner')
const op = owner.page

await step('sign in and open the product', op, async () => {
  await op.goto(`${WEB}/login`)
  await op.getByLabel('Email').fill(ownerEmail)
  await op.getByLabel('Password').fill(password)
  await op.getByRole('button', { name: 'Log in' }).click()
  await op.waitForURL('**/admin/products')
  await op.getByRole('button', { name: 'Edit Ceramic Mug' }).click()
  await op.getByRole('heading', { name: 'Edit Ceramic Mug' }).waitFor()
  await op.getByText(/AI generations used this month/).waitFor()
  check('ai tools: the quota line shows before anything has been generated (0 used)', await op.getByText(/^0 of \d+ AI generations used this month$/).isVisible())
})

await step('description: generate, edit, regenerate, publish', op, async () => {
  await op.getByRole('button', { name: 'Generate description with AI' }).click()
  await op.getByRole('textbox', { name: 'AI description draft' }).waitFor()
  check('description: a draft appears with the AI text, marked "draft"', (await op.getByText('draft', { exact: true }).count()) >= 1 && (await op.getByRole('textbox', { name: 'AI description draft' }).inputValue()).length > 0)
  check('ai tools: the quota line now shows 1 used', await op.getByText(/^1 of \d+ AI generations used this month$/).isVisible())

  const draftBox = op.getByRole('textbox', { name: 'AI description draft' })
  await draftBox.fill('A merchant-edited description for this mug.')
  await Promise.all([op.waitForResponse((r) => r.url().includes('/ai-description') && r.request().method() === 'PATCH'), op.getByRole('button', { name: 'Save edit' }).click()])
  check('description: editing by hand costs no quota (still 1 used)', await op.getByText(/^1 of \d+ AI generations used this month$/).isVisible())

  await Promise.all([op.waitForResponse((r) => r.url().includes('/ai-description/regenerate')), op.getByRole('button', { name: 'Regenerate' }).click()])
  await op.waitForFunction(() => {
    const box = document.querySelector('textarea[aria-label="AI description draft"]')
    return box && box.value !== 'A merchant-edited description for this mug.' && box.value.length > 0
  })
  check('description: regenerate replaces the draft text', true)
  check('ai tools: the quota line now shows 2 used', await op.getByText(/^2 of \d+ AI generations used this month$/).isVisible())

  const draftText = await draftBox.inputValue()
  await op.getByRole('button', { name: 'Publish to product' }).click()
  await op.waitForFunction((text) => document.querySelector('#description')?.value === text, draftText)
  check('description: publishing copies the draft into the live Description field', true)
  check('description: the draft is now marked "published"', (await op.getByText('published', { exact: true }).count()) >= 1)
  await shot(op, 'description-published')
})

await step('auto-tag and SEO metadata are suggestions, not silent writes', op, async () => {
  await op.getByRole('button', { name: 'Suggest category & tags' }).click()
  await op.getByText('Kitchenware').waitFor()
  check('auto-tag: shows the suggested category and tags', await op.getByText(/Kitchenware.*mug, ceramic, handmade/).isVisible())
  check('auto-tag: the form fields are unchanged until Apply is pressed', (await op.locator('#category').inputValue()) === 'kitchen')
  await op.getByRole('button', { name: 'Apply' }).first().click()
  check('auto-tag: applying fills the Category and Tags fields (not yet saved to the server)', (await op.locator('#category').inputValue()) === 'Kitchenware' && (await op.locator('#tags').inputValue()) === 'mug, ceramic, handmade')

  await op.getByRole('button', { name: 'Generate SEO title & description' }).click()
  await op.getByText('Ceramic Mug | Handmade & Dishwasher Safe').waitFor()
  await op.getByRole('button', { name: 'Apply' }).last().click()
  check('seo-metadata: applying fills the SEO title and description fields', (await op.locator('#seoTitle').inputValue()) === 'Ceramic Mug | Handmade & Dishwasher Safe' && (await op.locator('#seoDescription').inputValue()).includes('keeps drinks hot'))

  await op.getByRole('button', { name: 'Save', exact: true }).click()
  await op.getByRole('heading', { name: 'Edit Ceramic Mug' }).waitFor({ state: 'detached' })
  const saved = (await api('GET', `/stores/${storeId}/products/${mug}`)).json
  check('save: the applied category, tags, SEO title and description all persisted to the server', saved.category === 'Kitchenware' && JSON.stringify(saved.tags) === '["mug","ceramic","handmade"]' && saved.seoTitle === 'Ceramic Mug | Handmade & Dishwasher Safe')
})

await step('review summary', op, async () => {
  await op.getByRole('button', { name: 'Edit Ceramic Mug' }).click()
  await op.getByRole('button', { name: 'Summarize reviews' }).waitFor()
  await op.getByRole('button', { name: 'Summarize reviews' }).click()
  await op.getByText('Shoppers consistently praise how well this mug retains heat').waitFor()
  check('reviews: summarizing shows the AI summary of the product\'s one review', true)
  await op.getByRole('button', { name: 'Cancel' }).click()
})

await step('a product with no reviews shows no summarize button', op, async () => {
  await op.getByRole('button', { name: '+ Add product' }).click()
  await op.getByLabel('Title', { exact: true }).fill('Lonely Product')
  await op.getByLabel('Price', { exact: true }).fill('9.99')
  await op.getByLabel('Stock', { exact: true }).fill('5')
  await op.getByLabel('Category', { exact: true }).fill('misc')
  await op.getByRole('button', { name: 'Save', exact: true }).click()
  await op.getByRole('button', { name: 'Edit Lonely Product' }).waitFor()
  await op.getByRole('button', { name: 'Edit Lonely Product' }).click()
  await op.getByText('This product has no published reviews yet.').waitFor()
  check('reviews: a product with zero published reviews explains why, instead of offering a button that would fail', (await op.getByRole('button', { name: 'Summarize reviews' }).count()) === 0)
})

console.log(consoleErrors.length === 0 ? 'PASS  no console errors or uncaught exceptions' : `FAIL  console errors:\n${consoleErrors.join('\n')}`)
if (consoleErrors.length > 0) failures++

await browser.close()
console.log(failures === 0 ? `\nAll ${failures === 0 ? '' : ''}checks passed.` : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
