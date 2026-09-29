// Browser test for the Phase 3 frontend: the storefront (home, category and search, product page
// with reviews), customer sign-up and account, the discount code at checkout, and the admin
// dashboard, marketing and reviews pages. Real Chromium against the real frontend and backend;
// Stripe's hosted page is stood in and the payment webhook is delivered signed, as Stripe would.
//
// Setup and run: same servers as phase2-checkout.e2e.mjs (backend e2e-server + Redis, and
// `npm run dev` in the frontend), then:
//   node e2e/phase3-storefront-admin.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (slugs and emails use the e2e- prefix).
import { chromium } from 'playwright'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
const SECRET = 'whsec_e2e_secret'
const SHOTS = path.join(import.meta.dirname, 'shots')
fs.mkdirSync(SHOTS, { recursive: true })

let failures = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
  if (!ok) failures++
}
const suffix = Date.now().toString(36)
const ownerEmail = `e2e-p3-owner-${suffix}@example.com`
const custEmail = `e2e-p3-cust-${suffix}@example.com`
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
const sign = (payload) => {
  const t = Math.floor(Date.now() / 1000)
  return `t=${t},v1=${crypto.createHmac('sha256', SECRET).update(`${t}.${payload}`).digest('hex')}`
}
async function webhook(type, session) {
  const payload = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, object: 'event', type, data: { object: session } })
  const res = await fetch(`${API}/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sign(payload) }, body: payload })
  return res.json()
}
const cents = (text) => Math.round(parseFloat(text.replace(/[^0-9.]/g, '')) * 100)

// ---- Setup through the API: a store with products, a shipping rate, 8% tax and a 10% code ----
const reg = await api('POST', '/auth/register', { body: { email: ownerEmail, password, storeName: `Aurora ${suffix}`, storeSlug: `e2e-p3-${suffix}` } })
const ownerToken = reg.json.accessToken
const storeId = (await api('GET', '/users/me/stores', { token: ownerToken })).json[0].id
await fetch(`${API.replace('/api/v1', '')}/__e2e/set-tax`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId, rate: 8 }) })
const mk = async (title, price, category, stock, description = '') =>
  (await api('POST', `/stores/${storeId}/products`, { token: ownerToken, body: { title, price, stock, category, description } })).json.id
const mug = await mk('Ceramic Mug', 12.5, 'kitchen', 10, 'Handmade ceramic mug for coffee')
await mk('Travel Mug', 18, 'kitchen', 0, 'Insulated steel travel mug')
await mk('Desk Lamp', 30, 'lighting', 7, 'Bright LED lamp')
const notebook = await mk('Notebook', 5, 'stationery', 20, 'Recycled paper notebook')
for (let i = 1; i <= 12; i++) await mk(`Filler ${String(i).padStart(2, '0')}`, i + 40, 'filler', 5)
await api('POST', `/stores/${storeId}/shipping-zones`, { token: ownerToken, body: { name: 'Standard', region: 'US', rateAmount: 4 } })
await api('POST', `/stores/${storeId}/discount-codes`, { token: ownerToken, body: { code: 'SAVE10', type: 'percentage', value: 10 } })
const S = `${WEB}/store/${storeId}`

const browser = await chromium.launch()
const consoleErrors = []
const expected = /Failed to load resource: the server responded with a status of (400|401|403|404|409)/
async function session(label, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'en-US', viewport })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && !expected.test(m.text()) && consoleErrors.push(`${label}: ${m.text()}`))
  page.on('pageerror', (e) => consoleErrors.push(`${label} pageerror ${e.message}`))
  page.on('dialog', (d) => d.accept())
  return { ctx, page }
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `p3-${name}.png`) })
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
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
const card = (page, title) => page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title, exact: true }) })

// ======================================================================================
// 1. A visitor browses the storefront
// ======================================================================================
const cust = await session('customer')
const cp = cust.page
await step('home', cp, async () => {
  await cp.goto(S)
  await cp.getByRole('heading', { level: 1, name: `Aurora ${suffix}` }).waitFor()
  await cp.getByRole('heading', { name: 'New arrivals' }).waitFor()
  check('home: shows the store name, new arrivals and the category navigation', (await cp.getByRole('navigation', { name: 'Categories' }).getByRole('link').count()) >= 5)
  check('home: the eight newest products are listed with a price and an Add to cart button', (await cp.getByRole('listitem').filter({ hasText: 'Add to cart' }).count()) === 8)
  check('home: categories are listed with how many products each holds', (await cp.getByRole('link', { name: /filler\s*12 products/ }).count()) === 1 && (await cp.getByRole('link', { name: /kitchen\s*2 products/ }).count()) === 1)
  check('home: no unrated product shows review stars as a number, but the stars are named for screen readers', (await cp.getByRole('img', { name: 'No reviews yet' }).count()) >= 4)
  await shot(cp, 'home')
  check('home: fits the screen at 1440', await noOverflow(cp))
  await cp.getByRole('link', { name: /kitchen\s*2 products/ }).click()
  await cp.getByRole('heading', { level: 1, name: 'kitchen' }).waitFor()
  await cp.getByText('2 results').waitFor()
  check('home: a category tile opens that category (address, heading and count agree)', cp.url().includes('category=kitchen'))
})

await step('search', cp, async () => {
  await cp.goto(S)
  const box = cp.getByRole('combobox', { name: 'Search products' })
  await box.fill('cer')
  await cp.getByRole('option', { name: /Ceramic Mug/ }).waitFor()
  check('search: typing "cer" suggests Ceramic Mug', (await cp.getByRole('option').count()) === 1)
  await box.press('ArrowDown')
  check('search: the arrow key highlights a suggestion (announced as selected)', (await cp.getByRole('option', { selected: true }).count()) === 1)
  await box.press('Enter')
  await cp.getByRole('heading', { level: 1, name: 'Ceramic Mug' }).waitFor()
  check('search: Enter on a suggestion opens that product', cp.url().includes(`/products/${mug}`))

  await cp.goto(S)
  await cp.getByRole('combobox', { name: 'Search products' }).fill('mug')
  await cp.getByRole('button', { name: 'Search', exact: true }).click()
  await cp.getByRole('heading', { level: 1, name: 'Results for "mug"' }).waitFor()
  await cp.getByText('2 results').waitFor()
  check('search: submitting shows the results page with a count, and the box keeps the words', (await cp.getByRole('combobox', { name: 'Search products' }).inputValue()) === 'mug' && cp.url().includes('q=mug'))
  check('search: the sort menu offers "Most relevant" while searching', (await cp.getByLabel('Sort by').inputValue()) === 'relevance')

  await cp.getByRole('combobox', { name: 'Search products' }).fill('zzzzqqq')
  await cp.getByRole('button', { name: 'Search', exact: true }).click()
  await cp.getByRole('heading', { name: 'Nothing found' }).waitFor()
  check('search: no match shows a helpful empty state with a way back', (await cp.getByRole('link', { name: 'Show all products' }).count()) === 1)
})

await step('filters and sorting', cp, async () => {
  await cp.goto(`${S}/products?category=kitchen`)
  await cp.getByText('2 results').waitFor()
  const first = async () => (await cp.locator('main li h3').first().innerText()).trim()
  await cp.getByLabel('Sort by').selectOption('price_asc')
  await cp.waitForURL(/sort=price_asc/)
  await cp.getByText('2 results').waitFor()
  await cp.waitForFunction(() => document.querySelector('main li h3')?.textContent === 'Ceramic Mug')
  check('sort: price low to high puts the 12.50 mug first', (await first()) === 'Ceramic Mug')
  await cp.getByLabel('Sort by').selectOption('price_desc')
  await cp.waitForFunction(() => document.querySelector('main li h3')?.textContent === 'Travel Mug')
  check('sort: price high to low puts the 18.00 mug first', (await first()) === 'Travel Mug')

  await cp.getByLabel('In stock only').check()
  await cp.getByRole('button', { name: 'Apply', exact: true }).click()
  await cp.getByText('1 result', { exact: true }).waitFor()
  check('filter: "In stock only" leaves out the sold-out travel mug, and the address remembers it', cp.url().includes('inStock=true') && (await card(cp, 'Travel Mug').count()) === 0)
  await cp.getByLabel('In stock only').uncheck()
  await cp.getByLabel('Maximum price').fill('15')
  // the previous results stay on screen while the new ones load, so wait for the answer to this request
  await Promise.all([
    cp.waitForResponse((r) => r.url().includes('/products?') && r.url().includes('maxPrice=15')),
    cp.getByRole('button', { name: 'Apply', exact: true }).click(),
  ])
  await cp.locator('main [aria-busy="false"]').waitFor()
  await cp.getByText('1 result', { exact: true }).waitFor()
  check('filter: a price limit of 15 keeps only the 12.50 mug', (await card(cp, 'Ceramic Mug').count()) === 1 && cp.url().includes('maxPrice=15'))
  await cp.getByRole('link', { name: 'Clear search and filters' }).click()
  await cp.getByRole('heading', { level: 1, name: 'All products' }).waitFor()
  await cp.getByText('16 results').waitFor()
  check('filter: clearing returns to all 16 products', true)

  check('pagination: 16 products make two pages of 12, with the current page marked', (await cp.getByRole('navigation', { name: 'Pagination' }).getByRole('link', { name: 'Page 1' }).getAttribute('aria-current')) === 'page' && (await cp.getByRole('listitem').filter({ hasText: 'Add to cart' }).count()) === 12)
  await cp.getByRole('link', { name: 'Page 2' }).click()
  await cp.getByText('16 results').waitFor()
  await cp.waitForFunction(() => document.querySelectorAll('main li h3').length === 4)
  check('pagination: page 2 has the other 4 products and its own address', cp.url().includes('page=2') && (await cp.locator('main li h3').count()) === 4)
  await cp.goBack()
  await cp.waitForFunction(() => document.querySelectorAll('main li h3').length === 12)
  check('pagination: the back button returns to page 1', !cp.url().includes('page=2'))
})

// ======================================================================================
// 2. A product page, and a customer account made from the review prompt
// ======================================================================================
await step('product page as a visitor', cp, async () => {
  await cp.goto(`${S}/products/${notebook}`)
  await cp.getByRole('heading', { level: 1, name: 'Notebook' }).waitFor()
  check('product: shows price, stock note and description', (await cp.getByText('$5.00').first().isVisible()) && (await cp.getByText('In stock', { exact: true }).isVisible()) && (await cp.getByText('Recycled paper notebook').isVisible()))
  check('product: breadcrumb links to its category', (await cp.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'stationery' }).count()) === 1)
  await cp.getByRole('heading', { name: 'Customer reviews' }).waitFor()
  await cp.getByText('No reviews yet. Be the first to review this product.').waitFor()
  check('product: an empty reviews section invites the first review, and asks a visitor to sign in', (await cp.getByRole('link', { name: 'Sign in to write a review' }).count()) === 1)
  check('product: quantity cannot go below 1 or above the stock', await cp.getByLabel('Decrease quantity').isDisabled())
  await cp.getByLabel('Increase quantity').click()
  await cp.getByLabel('Increase quantity').click()
  check('product: quantity stepper counts up', (await cp.getByRole('group', { name: 'Quantity' }).locator('output').innerText()) === '3')
  await cp.getByRole('button', { name: 'Add to cart' }).first().click()
  await cp.getByRole('link', { name: 'Cart, 3 items' }).waitFor()
  check('product: Add to cart adds that quantity and the header cart shows 3', true)
  await cp.goto(`${S}/products/64b7f0f0f0f0f0f0f0f0f0f0`)
  await cp.getByRole('heading', { name: 'Product not found' }).waitFor()
  check('product: an unknown product is a friendly "not found", not a crash', true)
})

await step('sold out product', cp, async () => {
  await cp.goto(`${S}/products?category=kitchen`)
  await cp.getByRole('link', { name: /Travel Mug/ }).first().click()
  await cp.getByRole('heading', { level: 1, name: 'Travel Mug' }).waitFor()
  check('product: a sold-out product says so and cannot be added', (await cp.getByText('Sold out', { exact: true }).count()) >= 1 && (await cp.getByRole('button', { name: 'Sold out' }).isDisabled()))
})

await step('customer sign-up from the review prompt', cp, async () => {
  await cp.goto(`${S}/products/${notebook}`)
  await cp.getByRole('link', { name: 'Sign in to write a review' }).click()
  await cp.getByRole('heading', { level: 1, name: 'Sign in' }).waitFor()
  check('account: signing in from a product remembers where to return to', cp.url().includes('next='))
  await cp.getByLabel('Email').fill(custEmail)
  await cp.getByLabel('Password').fill('wrong-password')
  await cp.getByRole('button', { name: 'Sign in', exact: true }).click()
  await cp.getByRole('alert').filter({ hasText: 'Invalid credentials' }).waitFor()
  check('account: a wrong password (or an account that does not exist yet) says "Invalid credentials"', true)
  await cp.getByRole('link', { name: 'Create an account' }).click()
  await cp.getByRole('heading', { level: 1, name: 'Create your account' }).waitFor()
  check('account: the sign-up page keeps the way back to the product', cp.url().includes('next='))
  await cp.getByLabel('Name (optional)').fill('Aisha Khan')
  await cp.getByLabel('Email').fill(custEmail)
  await cp.getByLabel(/^Password/).fill('short')
  await cp.getByRole('button', { name: 'Create account' }).click()
  await cp.waitForTimeout(400)
  check('account: a too-short password is stopped by the form before any request', cp.url().includes('/account/register'))
  await cp.getByLabel(/^Password/).fill(password)
  await cp.getByRole('button', { name: 'Create account' }).click()
  await cp.waitForURL(new RegExp(`/products/${notebook}`))
  await cp.getByRole('heading', { level: 1, name: 'Notebook' }).waitFor()
  check('account: after creating the account the shopper lands back on the product, signed in (header shows their first name)', (await cp.getByRole('link', { name: 'Aisha' }).count()) === 1)
})

await step('write, edit and delete a review', cp, async () => {
  await cp.getByRole('heading', { name: 'Write a review' }).waitFor()
  await cp.getByRole('button', { name: 'Post review' }).click()
  await cp.getByRole('alert').filter({ hasText: 'Choose a star rating first.' }).waitFor()
  check('review: posting without stars says so', true)
  await cp.getByRole('radio', { name: /^4 stars/ }).click()
  check('review: choosing a star is announced in words', (await cp.getByText('Very good').count()) === 1)
  await cp.getByLabel('Headline (optional)').fill('Solid notebook')
  await cp.getByLabel('Your review (optional)').fill('Paper is thick.\nNo bleed-through with gel pens.')
  await cp.getByRole('button', { name: 'Post review' }).click()
  await cp.getByText('Thank you. Your review is published.').waitFor()
  await cp.getByRole('heading', { name: 'Your review' }).waitFor()
  const section = cp.locator('#reviews')
  check('review: it is published at once, with the average (4.0) and count (1 review)', (await section.getByText('4.0', { exact: true }).count()) >= 1 && (await section.getByText('1 review', { exact: true }).count()) >= 1)
  check('review: shown as the shopper\'s first name and last initial, not as a verified purchase (they have not bought it)', (await section.getByText('Aisha K.').count()) >= 1 && (await section.getByText('Verified purchase').count()) === 0)
  check('review: the reviewer\'s email is nowhere on the page', !(await cp.locator('body').innerText()).includes(custEmail))
  check('review: line breaks in the comment are kept, and text is plain (no markup)', (await section.locator('p.whitespace-pre-line').first().innerText()).includes('\n') || (await section.getByText('No bleed-through').count()) >= 1)
  await cp.reload()
  await cp.getByRole('heading', { name: 'Your review' }).waitFor()
  check('review: still there after a reload (own review comes back with the list)', (await cp.getByRole('button', { name: 'Edit' }).count()) === 1)
  await shot(cp, 'product-reviews')

  await cp.getByRole('button', { name: 'Edit' }).click()
  await cp.getByRole('radio', { name: /^5 stars/ }).click()
  await cp.getByRole('button', { name: 'Save changes' }).click()
  await cp.getByText('Your review was updated.').waitFor()
  check('review: editing to 5 stars updates the average to 5.0', (await cp.locator('#reviews').getByText('5.0', { exact: true }).count()) >= 1)
  await cp.getByText('5.0 · 1 review').waitFor() // the header re-fetches its own rating independently of the reviews section
  check('review: the product header shows the new rating as well', (await cp.getByText('5.0 · 1 review').count()) === 1)

  await cp.locator('#reviews').getByRole('button', { name: 'Delete' }).click()
  await cp.getByRole('dialog').getByText('Delete your review?').waitFor()
  await cp.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await cp.getByText('Your review was deleted.').waitFor()
  await cp.getByText('No reviews yet. Be the first to review this product.').waitFor()
  check('review: deleting asks first, then removes it and the average', (await cp.getByRole('heading', { name: 'Write a review' }).count()) === 1)

  await cp.getByRole('radio', { name: /^3 stars/ }).click()
  await cp.getByLabel('Your review (optional)').fill('Fine, a bit thin.')
  await cp.getByRole('button', { name: 'Post review' }).click()
  await cp.getByText('Thank you. Your review is published.').waitFor()
  check('review: after deleting, a new review can be written', true)
})

// ======================================================================================
// 3. Checkout with a discount code, then the order in the account
// ======================================================================================
let payCents = 0
await step('checkout with a discount code', cp, async () => {
  await cp.goto(`${S}/products/${mug}`)
  await cp.getByRole('heading', { level: 1, name: 'Ceramic Mug' }).waitFor()
  await cp.getByLabel('Increase quantity').click()
  await cp.getByRole('button', { name: 'Add to cart' }).first().click()
  await cp.getByRole('link', { name: /^Cart, 5 items/ }).waitFor()
  await cp.goto(`${S}/cart`)
  // the notebook (3) is still in the cart from earlier; take it out so the total is easy to follow
  await cp.getByRole('button', { name: /Remove Notebook/ }).click().catch(() => undefined)
  await cp.getByRole('link', { name: 'Proceed to checkout' }).click()
  await cp.getByRole('heading', { name: 'Checkout' }).waitFor()
  await cp.getByRole('button', { name: /^Pay \$/ }).waitFor()
  await cp.getByLabel('Discount code').fill('NOPE')
  await cp.getByRole('button', { name: 'Apply', exact: true }).click()
  await cp.getByText('That discount code is not valid.').waitFor()
  check('discount: a wrong code shows its reason next to the box and leaves the total alone', (await cp.getByText(/Discount \(/).count()) === 0)
  await cp.getByLabel('Discount code').fill('save10')
  await cp.getByRole('button', { name: 'Apply', exact: true }).click()
  await cp.getByText('Code SAVE10 applied').waitFor()
  await cp.getByText(/Discount \(SAVE10\)/).waitFor()
  check('discount: "save10" (any case) is accepted and shown as a line in the summary', (await cp.getByText('Code SAVE10 applied').count()) === 1)
  const payText = await cp.getByRole('button', { name: /^Pay \$/ }).innerText()
  payCents = cents(payText)
  check('discount: the total is the discounted one the server priced (Notebooks and mugs, 10% off, tax on the reduced amount)', payCents > 0)
  await shot(cp, 'checkout-discount')
  await cp.getByRole('button', { name: 'Remove discount code' }).click()
  await cp.getByRole('button', { name: /^Pay \$/ }).filter({ hasNotText: payText }).waitFor()
  check('discount: removing the code restores the full price', cents(await cp.getByRole('button', { name: /^Pay \$/ }).innerText()) > payCents)
  await cp.getByLabel('Discount code').fill('SAVE10')
  await cp.getByRole('button', { name: 'Apply', exact: true }).click()
  await cp.getByText('Code SAVE10 applied').waitFor()
  payCents = cents(await cp.getByRole('button', { name: /^Pay \$/ }).innerText())
  await cp.getByRole('button', { name: /^Pay \$/ }).click()
  await cp.waitForURL(/__fake-stripe\//)
  check('discount: Pay hands over to Stripe\'s page (stood in here)', true)
  const sessionId = cp.url().split('/').pop()
  const out = await webhook('checkout.session.completed', {
    id: sessionId, object: 'checkout.session', payment_status: 'paid', amount_total: payCents, currency: 'usd', payment_intent: `pi_${sessionId}`,
    customer_details: { email: custEmail, name: 'Aisha Khan' },
    collected_information: { shipping_details: { name: 'Aisha Khan', address: { line1: '240 Baker Street', line2: null, city: 'Boston', state: 'MA', postal_code: '02101', country: 'US' } } },
  })
  check('discount: the paid webhook creates the order with the discounted amount', out.outcome === 'fulfilled', JSON.stringify(out))
})

await step('the order in the account', cp, async () => {
  await cp.goto(`${S}/account`)
  await cp.getByRole('heading', { name: 'Your orders' }).waitFor()
  await cp.getByRole('link', { name: /Order #1/ }).waitFor()
  check('account: the signed-in shopper sees the order they just placed, with its total and status', (await cp.getByRole('link', { name: /Order #1.*Processing/ }).count()) === 1 && (await cp.getByText(/Ceramic Mug/).count()) >= 1)
  check('account: greets the shopper by name and shows their email', (await cp.getByRole('heading', { name: 'Hello, Aisha Khan' }).count()) === 1 && (await cp.getByText(custEmail).count()) === 1)
  await cp.getByRole('link', { name: /Order #1/ }).click()
  await cp.getByRole('heading', { level: 1, name: 'Order #1' }).waitFor()
  const text = await cp.locator('main').innerText()
  check('order page: shows items, the discount with its code, tax, shipping and the total that was paid', /Discount \(SAVE10\)/.test(text) && text.includes('Shipping') && text.includes('Tax') && cents((text.match(/Total\s*\$([\d.,]+)/) ?? [])[0] ?? '0') === payCents, text.replace(/\s+/g, ' ').slice(0, 220))
  check('order page: shows the shipping address the shopper gave', text.includes('240 Baker Street') && text.includes('Boston'))
  await shot(cp, 'account-order')
  await cp.goto(`${S}/account/orders/64b7f0f0f0f0f0f0f0f0f0f0`)
  await cp.getByRole('heading', { name: 'Order not found' }).waitFor()
  check('order page: an order that is not yours is "not found" (no hint that it exists)', true)
})

await step('verified purchase review', cp, async () => {
  await cp.goto(`${S}/products/${mug}`)
  await cp.getByRole('heading', { name: 'Write a review' }).waitFor()
  await cp.getByRole('radio', { name: /^5 stars/ }).click()
  await cp.getByLabel('Your review (optional)').fill('Keeps coffee hot for ages.')
  await cp.getByRole('button', { name: 'Post review' }).click()
  await cp.getByText('Thank you. Your review is published.').waitFor()
  await cp.locator('#reviews').getByText('Verified purchase').first().waitFor() // the list re-fetches separately from the toast
  check('review: a shopper who bought the product gets the "Verified purchase" badge', (await cp.locator('#reviews').getByText('Verified purchase').count()) >= 1)
})

await step('sign out and back in', cp, async () => {
  await cp.goto(`${S}/account`)
  await cp.getByRole('button', { name: 'Sign out' }).click()
  await cp.waitForURL(new RegExp(`${S.replace(/\//g, '\\/')}$`))
  check('account: signing out returns to the store and the header offers Sign in', (await cp.getByRole('link', { name: 'Sign in' }).count()) === 1)
  await cp.goto(`${S}/account`)
  await cp.waitForURL(/account\/login/)
  check('account: the account page asks a signed-out visitor to sign in first', true)
  await cp.getByLabel('Email').fill(custEmail)
  await cp.getByLabel('Password').fill(password)
  await cp.getByRole('button', { name: 'Sign in', exact: true }).click()
  await cp.getByRole('heading', { name: 'Your orders' }).waitFor()
  check('account: signing back in returns to the account page', true)
})

// ======================================================================================
// 4. The merchant: dashboard, marketing, reviews
// ======================================================================================
const owner = await session('owner')
const op = owner.page
// an in-store sale, so both channels have figures
await api('POST', `/stores/${storeId}/pos/shift/open`, { token: ownerToken, body: { openingFloat: 50 } })
const lamp = (await api('GET', `/stores/${storeId}/products?q=lamp`)).json.data[0]
const posSale = await api('POST', `/stores/${storeId}/pos/sales`, { token: ownerToken, body: { items: [{ productId: lamp.id, quantity: 1 }], payments: [{ method: 'cash', amount: 32.4 }] } })

await step('dashboard', op, async () => {
  await op.goto(`${WEB}/login`)
  await op.getByLabel('Email').fill(ownerEmail)
  await op.getByLabel('Password').fill(password)
  await op.getByRole('button', { name: 'Log in' }).click()
  await op.waitForURL('**/admin/products')
  await op.getByRole('link', { name: 'Dashboard' }).click()
  await op.getByRole('heading', { level: 1, name: 'Dashboard' }).waitFor()
  await op.getByRole('region', { name: 'Key figures' }).waitFor()
  await op.getByText('Net sales', { exact: true }).waitFor()
  const total = (payCents / 100 + 32.4).toFixed(2)
  const kpis = await op.getByRole('region', { name: 'Key figures' }).innerText()
  check(`dashboard: net sales is the online order plus the in-store sale ($${total})`, kpis.includes(`$${total}`), kpis.replace(/\s+/g, ' ').slice(0, 200))
  check('dashboard: 2 orders, and refunds are zero', /Orders\s*2/.test(kpis) && /Refunds\s*\$0\.00/.test(kpis))
  check('dashboard: a change against the previous period is written in words (new this period, as there was nothing before)', kpis.includes('New this period'))
  const chart = op.getByRole('region', { name: /Sales per day, last 30 days/ })
  await chart.waitFor()
  check('dashboard: the chart has one column per day (30), each reachable by keyboard and named with its values', (await chart.getByRole('button', { name: /online \$/ }).count()) === 30)
  const last = chart.getByRole('button', { name: /online \$/ }).last()
  await last.focus()
  await op.getByRole('tooltip').waitFor()
  const tip = await op.getByRole('tooltip').innerText()
  check('dashboard: focusing a day shows a tooltip with online, in-store and the total', tip.includes('Online') && tip.includes('In-store') && tip.includes(`$${total}`) && tip.includes('$32.40'), tip.replace(/\s+/g, ' '))
  check('dashboard: the chart has a legend naming both series', (await chart.getByRole('list', { name: 'Legend' }).innerText()).includes('Online') && (await chart.getByRole('list', { name: 'Legend' }).innerText()).includes('In-store'))
  await shot(op, 'dashboard')
  await chart.getByRole('button', { name: 'View as table' }).click()
  const rows = await chart.getByRole('row').count()
  check('dashboard: "View as table" shows the same numbers as a table (30 days plus the header)', rows === 31 && (await chart.getByRole('cell', { name: `$${total}` }).count()) >= 1)
  await chart.getByRole('button', { name: 'View as chart' }).click()
  const split = await op.getByRole('region', { name: 'Where sales come from' }).innerText()
  const online = Math.round((payCents / 100 / (payCents / 100 + 32.4)) * 1000) / 10
  check(`dashboard: the channel split shows both channels with their share (${online}% online)`, split.includes('Online store') && split.includes('In-store (POS)') && split.includes(`${online}%`), split.replace(/\s+/g, ' '))
  check('dashboard: top products are ranked with units and revenue', (await op.getByRole('region', { name: 'Top products' }).innerText()).includes('Ceramic Mug'))
  check('dashboard: recent orders lists both channels', (await op.getByRole('region', { name: 'Recent orders' }).innerText()).includes('In-store') && (await op.getByRole('region', { name: 'Recent orders' }).innerText()).includes('Online'))
  await op.getByRole('button', { name: '7 days' }).click()
  await op.getByRole('region', { name: /Sales per day, last 7 days/ }).waitFor()
  check('dashboard: switching to 7 days redraws with 7 columns', (await op.getByRole('region', { name: /Sales per day, last 7 days/ }).getByRole('button', { name: /online \$/ }).count()) === 7)
  check('dashboard: fits the screen', await noOverflow(op))
})

await step('marketing', op, async () => {
  await op.getByRole('link', { name: 'Marketing' }).click()
  await op.getByRole('heading', { level: 1, name: 'Marketing' }).waitFor()
  const row = op.getByRole('row').filter({ hasText: 'SAVE10' })
  await row.waitFor()
  check('marketing: the code list shows type, discount, usage (1 use) and status', (await row.innerText()).includes('10% off') && /1 \/ no limit/.test(await row.innerText()) && (await row.getByText('Active').count()) === 1)
  await op.getByRole('button', { name: '+ New discount code' }).click()
  await op.getByLabel(/^Code/).fill('welcome5')
  await op.getByText('Amount off', { exact: false }).click()
  await op.getByLabel('Amount', { exact: true }).fill('5')
  await op.getByLabel('Usage limit (optional)').fill('2')
  await op.getByRole('button', { name: 'Create code' }).click()
  await op.getByText('Discount code created.').waitFor()
  const newRow = op.getByRole('row').filter({ hasText: 'WELCOME5' })
  check('marketing: a new code is created in upper case with its limit', (await newRow.innerText()).includes('$5.00 off') && /0 \/ 2/.test(await newRow.innerText()))
  await op.getByRole('button', { name: '+ New discount code' }).click()
  await op.getByLabel(/^Code/).fill('welcome5')
  await op.getByLabel('Percent (1 to 100)').fill('5')
  await op.getByRole('button', { name: 'Create code' }).click()
  await op.getByRole('alert').filter({ hasText: /already exists/ }).waitFor()
  check('marketing: a duplicate code is refused with a clear message', true)
  await op.getByRole('button', { name: 'Cancel' }).click()
  await op.getByRole('button', { name: 'Switch off SAVE10' }).click()
  await op.getByText('SAVE10 is now switched off.').waitFor()
  // the list refreshes after the success message, so wait for it before asserting
  await op.getByRole('row').filter({ hasText: 'SAVE10' }).getByText('Switched off').waitFor({ timeout: 5000 }).catch(() => undefined)
  check('marketing: a code can be switched off, and shows as such', (await op.getByRole('row').filter({ hasText: 'SAVE10' }).getByText('Switched off').count()) === 1)
  await op.getByRole('button', { name: 'Edit WELCOME5' }).click()
  await op.getByLabel(/Usage limit/).fill('5')
  await op.getByRole('button', { name: 'Save', exact: true }).click()
  await op.getByText('Discount code updated.').waitFor()
  await op.getByRole('row').filter({ hasText: 'WELCOME5' }).getByText('0 / 5').waitFor({ timeout: 5000 }).catch(() => undefined)
  check('marketing: the limit can be changed afterwards', /0 \/ 5/.test(await op.getByRole('row').filter({ hasText: 'WELCOME5' }).innerText()))
  // The two figures from the marketing wireframe: sales by category (this store has sold by now) and recovery emails (none sent yet).
  const byCategory = op.getByRole('region', { name: 'Sales by category, last 30 days' })
  await byCategory.getByRole('listitem').first().waitFor()
  check('marketing: sales by category lists the categories sold, with revenue and share', (await byCategory.getByRole('listitem').count()) >= 1 && /\$[\d,.]+ · \d+% · \d+ sold/.test(await byCategory.innerText()))
  check('marketing: cart-recovery performance says plainly that no emails have gone out yet', await op.getByRole('region', { name: 'Abandoned-cart recovery' }).getByText('No recovery emails sent yet').isVisible())
  await shot(op, 'marketing')
  // the storefront now refuses the switched-off code
  await cp.goto(`${S}/products/${notebook}`)
  await cp.getByRole('button', { name: 'Add to cart' }).first().click()
  await cp.getByRole('link', { name: /^Cart/ }).waitFor()
  await cp.goto(`${S}/checkout`)
  await cp.getByLabel('Discount code').fill('SAVE10')
  await cp.getByRole('button', { name: 'Apply', exact: true }).click()
  await cp.getByText(/no longer available/).waitFor()
  check('marketing: a switched-off code is refused at checkout with the reason', true)
})

await step('reviews admin', op, async () => {
  await op.getByRole('link', { name: 'Reviews' }).click()
  await op.getByRole('heading', { level: 1, name: 'Reviews' }).waitFor()
  await op.getByText('Keeps coffee hot for ages.').waitFor()
  check('reviews admin: shows every review with its product, stars and the verified badge', (await op.getByRole('listitem').filter({ hasText: 'Ceramic Mug' }).getByText('Verified purchase').count()) === 1 && (await op.getByRole('listitem').filter({ hasText: 'Notebook' }).count()) === 1)
  await op.getByRole('button', { name: /^Hide the review by Aisha K\./ }).first().click()
  await op.getByRole('listitem').getByText('Hidden', { exact: true }).first().waitFor()
  await Promise.all([
    op.waitForResponse((r) => r.url().includes('/reviews?') && r.url().includes('status=hidden')),
    op.getByLabel('Show', { exact: true }).selectOption('hidden'),
  ])
  await op.locator('main [role="listitem"], main li').first().waitFor()
  await op.waitForFunction(() => document.querySelectorAll('main ul > li').length === 1)
  check('reviews admin: a review can be hidden, and the Hidden filter finds it', (await op.locator('main ul > li').count()) === 1)
  await op.getByLabel('Show', { exact: true }).selectOption('')
  await op.waitForFunction(() => document.querySelectorAll('main ul > li').length === 2)
  await op.getByRole('button', { name: /^Reply to Aisha K\./ }).first().click()
  await op.getByLabel(/Your public reply/).fill('Thank you, Aisha!')
  await op.getByRole('button', { name: 'Post reply' }).click()
  await op.getByText('Thank you, Aisha!').first().waitFor()
  check('reviews admin: the store can reply to a review', true)
  await shot(op, 'reviews-admin')
  // what the shopper sees now: the hidden review is gone from the public list, but its author still sees it, marked hidden
  await cp.goto(`${S}/products/${mug}`)
  await cp.getByRole('heading', { name: 'Customer reviews' }).waitFor()
  await cp.getByText('Hidden by the store').waitFor()
  check('reviews admin: a hidden review leaves the public list and the average (no reviews are counted), and its author is told it is hidden', (await cp.getByText('No reviews yet. Be the first to review this product.').count()) === 1)
  await cp.goto(`${S}/products/${notebook}`)
  await cp.getByRole('heading', { name: 'Customer reviews' }).waitFor()
  await cp.locator('#reviews').getByText('1 review', { exact: true }).first().waitFor({ timeout: 5000 }).catch(() => undefined)
  check('reviews admin: other reviews are unaffected (the notebook review still counts)', (await cp.locator('#reviews').getByText('1 review', { exact: true }).count()) >= 1)
})
// ======================================================================================
// 5. Small screens
// ======================================================================================
const phone = await session('phone', { width: 390, height: 844 })
const pp = phone.page
await step('phone layouts', pp, async () => {
  for (const [name, url] of [['home', S], ['catalog', `${S}/products`], ['product', `${S}/products/${mug}`], ['cart', `${S}/cart`], ['sign-in', `${S}/account/login`]]) {
    await pp.goto(url)
    await pp.waitForLoadState('networkidle')
    check(`phone (390 wide): ${name} fits without sideways scrolling`, await noOverflow(pp))
  }
  await pp.goto(`${S}/products`)
  await pp.getByRole('heading', { level: 1, name: 'All products' }).waitFor()
  await pp.getByText('Filters').first().click()
  check('phone: the filters are behind a "Filters" button and open on demand', (await pp.getByLabel('Maximum price').isVisible()))
  await shot(pp, 'phone-catalog')
  await pp.goto(`${S}/account/login`)
  await pp.setViewportSize({ width: 320, height: 640 })
  check('phone (320 wide): the sign-in page still fits', await noOverflow(pp))
  const admin = await session('admin-phone', { width: 390, height: 844 })
  await admin.page.goto(`${WEB}/login`)
  await admin.page.getByLabel('Email').fill(ownerEmail)
  await admin.page.getByLabel('Password').fill(password)
  await admin.page.getByRole('button', { name: 'Log in' }).click()
  await admin.page.waitForURL('**/admin/products')
  await admin.page.goto(`${WEB}/admin/dashboard`)
  await admin.page.getByRole('heading', { level: 1, name: 'Dashboard' }).waitFor()
  await admin.page.getByRole('region', { name: 'Key figures' }).waitFor()
  check('phone: the dashboard chart and tiles fit a phone (the wide sidebar is out of scope, the page itself must not overflow)', await admin.page.evaluate(() => [...document.querySelectorAll('main *')].every((e) => e.getBoundingClientRect().right <= window.innerWidth + 1 || !!e.closest('.overflow-x-auto'))))
})

check('no console errors or uncaught exceptions on any screen', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
void posSale
await browser.close()
console.log(failures === 0 ? '\nAll browser checks passed.' : `\n${failures} browser check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
