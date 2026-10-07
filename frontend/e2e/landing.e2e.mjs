// Browser test for the ShopMind AI landing page at "/".
//
// What it proves: every section is present and in order; the live demo answers and labels where its
// answer came from; the FAQ opens with a keyboard; the two calls to action lead to the right halves
// of the product; a signed-in visitor never sees the page at all; and it fits a phone, a tablet and
// a desktop without scrolling sideways.
//
// Setup and run: backend (npx tsx scripts/e2e-server.ts) and Redis, and `npm run dev` in the
// frontend, then: node e2e/landing.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (emails and slugs use the e2e- prefix).
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
async function session(label, viewport = { width: 1440, height: 900 }) {
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
    await page.screenshot({ path: path.join(SHOTS, `landing-failure-${name.replace(/\W+/g, '-')}.png`) }).catch(() => undefined)
  }
}

const page = await session('visitor')

// ---- The page itself -------------------------------------------------------------------------

await step('the page loads', page, async () => {
  await page.goto(WEB, { waitUntil: 'networkidle' })
  check('"/" shows the landing page, not the dashboard', !page.url().includes('/admin'), page.url())
  check('there is exactly one h1', (await page.locator('h1').count()) === 1)
  check('the h1 leads with the trending idea', /searching for/i.test(await page.locator('h1').innerText()))
  check('the page title is set for search engines', (await page.title()).includes('ShopMind AI'), await page.title())
  const description = await page.locator('meta[name="description"]').getAttribute('content')
  check('a meta description is present', (description ?? '').length > 60)
  const og = await page.locator('meta[property="og:image"]').getAttribute('content')
  check('an Open Graph image is declared', (og ?? '').includes('og-image'), og ?? 'none')
})

await step('every section is present, in order', page, async () => {
  const headings = await page.locator('main h2').allInnerTexts()
  const order = headings.join(' | ')
  check('the problem section comes before the features', /should not be this expensive/i.test(order))
  check('the AI feature block is introduced', /the ai is the product/i.test(order))
  const featureTitles = (await page.locator('#features h3').allInnerTexts()).join(' | ')
  check('trending suggestions is the first AI feature', /^trending suggestions, while you add the product/i.test(featureTitles.trim()))
  check('all five AI features are shown', (await page.locator('#features h3').count()) === 5, String(await page.locator('#features h3').count()))
  check('the commerce feature grid is there', /everything else a shop actually needs/i.test(order))
  check('how it works is there', /live in three steps/i.test(order))
  check('the comparison is there', /why shopmind ai/i.test(order))
  check('pricing is there', /start free/i.test(order))
  check('trust is there', /safe/i.test(order))
  check('the FAQ is there', /questions, answered straight/i.test(order))
  check('the final call to action is there', /online tonight/i.test(order))
  // Heading order: never skip a level. A screen reader user navigates this page by headings.
  const levels = await page.locator('main h1, main h2, main h3').evaluateAll((els) => els.map((e) => Number(e.tagName[1])))
  const skips = levels.filter((lvl, i) => i > 0 && lvl > levels[i - 1] + 1)
  check('no heading level is skipped anywhere on the page', skips.length === 0, levels.join(','))
  check('the page starts at h1', levels[0] === 1)

  await page.screenshot({ path: path.join(SHOTS, 'landing-full.png'), fullPage: true })
})

// ---- The live demo ---------------------------------------------------------------------------

await step('the demo answers on load', page, async () => {
  const demo = page.getByRole('region', { name: 'Try it now' })
  await demo.getByRole('listitem').first().waitFor({ timeout: 20000 })
  const cards = demo.getByRole('listitem')
  check('the demo shows suggestions without the visitor doing anything', (await cards.count()) === 3, String(await cards.count()))
  check('it is labelled as trending in Pakistan', await demo.getByText('Trending in Pakistan').isVisible())
  const text = await demo.innerText()
  check('at least one suggestion names the popular searches it uses', /Uses popular searches:/i.test(text))
  check('it says where the answer came from', /prepared example|written just now|from the cache/i.test(text), text.slice(-120))
  check('no search volume or count is shown anywhere in the demo', !/\b\d+\s*(searches|monthly|per month|volume)\b/i.test(text))
})

await step('the demo answers a typed product', page, async () => {
  const demo = page.getByRole('region', { name: 'Try it now' })
  await demo.getByLabel('A product you sell').fill(`handwoven basket ${suffix}`)
  await demo.getByRole('button', { name: 'Suggest' }).click()
  await page.waitForTimeout(1200)
  await demo.getByRole('listitem').first().waitFor({ timeout: 30000 })
  check('typing a product still produces suggestions', (await demo.getByRole('listitem').count()) >= 1)
  check('and the page explains what it just showed', /prepared example|written just now|from the cache|saved example/i.test(await demo.innerText()))
})

await step('the example chips work', page, async () => {
  const demo = page.getByRole('region', { name: 'Try it now' })
  await demo.getByRole('button', { name: 'clay chai cups' }).click()
  await page.waitForTimeout(1500)
  check('clicking an example fills the box', (await demo.getByLabel('A product you sell').inputValue()).includes('clay'))
  check('and shows its suggestions', (await demo.getByRole('listitem').count()) >= 1)
})

// ---- Pricing is read from the server, not typed in ---------------------------------------------

await step('pricing matches the real plans', page, async () => {
  const plans = (await api('GET', '/plans')).json
  const pricing = page.locator('#pricing')
  await pricing.getByRole('heading', { name: 'Free', exact: true }).waitFor({ timeout: 15000 })
  const text = await pricing.innerText()
  for (const plan of plans.plans) {
    check(`the ${plan.name} plan is shown`, text.includes(plan.name))
    if (plan.priceCents > 0) check(`the ${plan.name} price matches the server ($${plan.priceCents / 100})`, text.includes(`$${plan.priceCents / 100}`))
  }
  check('the rupee figure is marked as a conversion, not as the charged price', /at Rs \d+ to the dollar/i.test(text))
  check('the free plan says no card is needed', /no card needed/i.test(text))
  check('the custom domain is honestly marked as coming soon', /coming soon/i.test(text))
})

// ---- The FAQ, with a keyboard -------------------------------------------------------------------

await step('the FAQ opens with a keyboard', page, async () => {
  const first = page.locator('#faq details').first()
  check('answers start closed', !(await first.evaluate((el) => el.open)))
  await first.locator('summary').focus()
  await page.keyboard.press('Enter')
  check('Enter opens an answer', await first.evaluate((el) => el.open))
  check('the answer is readable once open', (await first.innerText()).length > 120)
})

// ---- The two calls to action --------------------------------------------------------------------

await step('the calls to action lead to the right places', page, async () => {
  await page.goto(WEB)
  await page.getByRole('link', { name: 'Shop now' }).click()
  await page.waitForURL('**/shop')
  check('"Shop now" opens the shop directory', page.url().endsWith('/shop'))

  await page.goto(WEB)
  await page.getByRole('link', { name: 'Start your store free' }).first().click()
  await page.waitForURL('**/register')
  check('"Start your store free" opens the owner sign-up', page.url().endsWith('/register'))
})

// ---- A signed-in visitor skips the page ----------------------------------------------------------

await step('a signed-in owner never sees the landing page', page, async () => {
  const email = `e2e-landing-owner-${suffix}@example.com`
  const reg = await api('POST', '/auth/register', {
    body: { email, password, storeName: `E2E Landing ${suffix}`, storeSlug: `e2e-landing-${suffix}`, currency: 'PKR' },
  })
  check('setup: the shop was created', reg.status === 201, String(reg.status))

  await page.goto(`${WEB}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL('**/admin/**')

  await page.goto(WEB)
  await page.waitForURL('**/admin/**', { timeout: 15000 })
  check('an owner opening "/" is taken to their dashboard', page.url().includes('/admin'), page.url())
})

await step('a signed-in shopper is taken to the directory', page, async () => {
  const email = `e2e-landing-shopper-${suffix}@example.com`
  await api('POST', '/auth/register-customer', { body: { email, password } })
  await page.goto(`${WEB}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL('**/shop')
  await page.goto(WEB)
  await page.waitForURL('**/shop', { timeout: 15000 })
  check('a shopper opening "/" is taken to the shop directory', page.url().endsWith('/shop'))
})

// ---- Sizes ----------------------------------------------------------------------------------------

for (const [label, width, height] of [
  ['phone', 375, 812],
  ['tablet', 768, 1024],
  ['desktop', 1440, 900],
]) {
  await step(`the page fits a ${label}`, page, async () => {
    const sized = await session(label, { width, height })
    await sized.goto(WEB, { waitUntil: 'networkidle' })
    await sized.waitForTimeout(1500)
    const wide = await sized.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    check(`${label} (${width} wide): no sideways scrolling`, !wide)

    if (width < 1024) {
      const menu = sized.getByRole('button', { name: /menu/i })
      check(`${label}: the navigation collapses into a menu button`, await menu.isVisible())
      await menu.click()
      // Scoped to the menu: "Pricing" is also a footer link, so an unscoped lookup matches two.
      check(`${label}: the menu opens`, await sized.locator('#landing-mobile-menu').getByRole('link', { name: 'Pricing' }).isVisible())
      check(`${label}: and reports its state to a screen reader`, (await menu.getAttribute('aria-expanded')) === 'true')
    }
    await sized.screenshot({ path: path.join(SHOTS, `landing-${label}.png`), fullPage: true })
    await sized.context().close()
  })
}

check('no unexpected console or page errors', errors.length === 0, errors.join(' | '))

await browser.close()
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
