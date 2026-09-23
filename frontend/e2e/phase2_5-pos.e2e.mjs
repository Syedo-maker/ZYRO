// Browser test for Phase 2.5 (the point of sale), in real Chromium against the real frontend
// and backend: the owner adds a cashier and a manager and sets the discount limit, the cashier
// opens a shift, scans and searches products, applies discounts within their limit, holds and
// resumes a cart, takes a split cash and card payment, prints a receipt and closes the drawer
// (short), then the manager takes items back, reads the daily summary and closes their shift.
//
// Setup and run: same servers as phase2-checkout.e2e.mjs (backend e2e-server + Redis, and
// `npm run dev` in the frontend), then:
//   node e2e/phase2_5-pos.e2e.mjs
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
const password = 'password123'
const ownerEmail = `e2e-pos-owner-${suffix}@example.com`
const cashierEmail = `e2e-pos-cashier-${suffix}@example.com`
const managerEmail = `e2e-pos-manager-${suffix}@example.com`
const noAccessEmail = `e2e-pos-none-${suffix}@example.com`

async function api(method, p, { token, body } = {}) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}

// ---- Setup through the API: an owner with a store, one product with a barcode, and a person with no register access.
const reg = await api('POST', '/auth/register', {
  body: { email: ownerEmail, password, storeName: `POS Shop ${suffix}`, storeSlug: `e2e-pos-${suffix}` },
})
const ownerToken = reg.json.accessToken
const storeId = (await api('GET', '/users/me/stores', { token: ownerToken })).json[0].id
const widget = (await api('POST', `/stores/${storeId}/products`, { token: ownerToken, body: { title: 'Widget', price: 20, stock: 10, category: 'tools' } })).json
const gadget = (await api('POST', `/stores/${storeId}/products`, { token: ownerToken, body: { title: 'Gadget', price: 10.5, stock: 2, category: 'tools' } })).json
await api('POST', '/auth/register', { body: { email: noAccessEmail, password, storeName: 'Other', storeSlug: `e2e-pos-x-${suffix}` } })

const browser = await chromium.launch()
const consoleErrors = []
// The silent-login 401 and deliberate rejections (400, 403, 409) show up as network log lines; they are expected.
const expected = /Failed to load resource: the server responded with a status of (400|401|403|409)/
function watch(page, label) {
  page.on('console', (m) => m.type() === 'error' && !expected.test(m.text()) && consoleErrors.push(`${label}: ${m.text()}`))
  page.on('pageerror', (e) => consoleErrors.push(`${label} pageerror ${e.message}`))
}
async function newSession(label, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'en-US', viewport })
  await ctx.addInitScript(() => {
    // Record print requests instead of opening the print preview.
    window.__prints = 0
    window.print = () => {
      window.__prints++
    }
  })
  const page = await ctx.newPage()
  page.on('dialog', (d) => d.accept())
  watch(page, label)
  return { ctx, page }
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `pos-${name}.png`) })
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

async function step(name, page, fn) {
  try {
    await fn()
  } catch (e) {
    failures++
    const shown = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 260)).catch(() => '')
    console.log(`FAIL  ${name}  (${String(e.message).split('\n')[0]})  url=${page.url()}  page="${shown}"`)
    await shot(page, `failure-${name.replace(/\W+/g, '-')}`).catch(() => undefined)
  }
}

// ======================================================================================
// 1. The owner sets up the team, the discount limit and a scannable product in the admin
// ======================================================================================
const owner = await newSession('owner')
await step('owner: team, limit and product setup', owner.page, async () => {
  const { page } = owner
  await page.goto(`${WEB}/login`)
  await page.getByLabel('Email').fill(ownerEmail)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL('**/admin/products')

  await page.getByRole('link', { name: 'Team & register' }).click()
  await page.getByRole('heading', { name: 'Team and register' }).waitFor()
  check('team: the nav has a Team & register page and an Open register link', (await page.getByRole('link', { name: 'Open register' }).count()) === 1)

  await page.getByLabel('Name', { exact: true }).fill('Riley Chen')
  await page.getByLabel('Email', { exact: true }).fill(cashierEmail)
  await page.getByLabel(/Starting password/).fill(password)
  await page.getByRole('button', { name: 'Add to team' }).click()
  await page.getByText(`${cashierEmail} was added as a cashier.`).waitFor()
  check('team: a new cashier is created with a starting password', true)
  await page.getByRole('listitem').filter({ hasText: cashierEmail }).getByText('Cashier', { exact: true }).waitFor()
  check('team: the cashier appears in the staff list with the Cashier role', true)

  await page.getByLabel('Name', { exact: true }).fill('Sam Okafor')
  await page.getByLabel('Email', { exact: true }).fill(managerEmail)
  await page.getByLabel(/Starting password/).fill(password)
  await page.getByRole('radio', { name: /^Manager/ }).check()
  await page.getByRole('button', { name: 'Add to team' }).click()
  await page.getByText(`${managerEmail} was added as a manager.`).waitFor()
  await page.getByRole('listitem').filter({ hasText: managerEmail }).getByText('Manager', { exact: true }).waitFor()
  check('team: a manager is created the same way', true)

  await page.getByLabel('Email', { exact: true }).fill(ownerEmail)
  await page.getByLabel(/Starting password/).fill(password)
  await page.getByRole('button', { name: 'Add to team' }).click()
  await page.getByRole('alert').filter({ hasText: /already has an account/ }).waitFor()
  check('team: a password for an email that already has an account is refused', true)

  await page.getByLabel('Percent', { exact: true }).fill('10')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Cashiers can now give up to 10% off.').waitFor()
  check('team: the owner sets the cashier discount limit to 10%', true)
  await shot(page, 'team')

  await page.getByRole('link', { name: 'Products' }).click()
  await page.getByRole('button', { name: '+ Add product' }).click()
  await page.getByLabel('Title', { exact: true }).fill('Scanner Mug')
  await page.getByLabel('Price').fill('12')
  await page.getByLabel('Stock').fill('5')
  await page.getByLabel('Category').fill('kitchen')
  await page.getByLabel('SKU (optional)').fill(`MUG-${suffix}`)
  await page.getByLabel('Barcode (optional)').fill(`5901234${suffix}`)
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Scanner Mug').first().waitFor()
  check('product form: SKU, barcode and the tax switch are on the product form and save', true)
})
const barcode = `5901234${suffix}`

// ======================================================================================
// 2. A person with no register access is turned away politely
// ======================================================================================
const nobody = await newSession('nobody')
await step('no access', nobody.page, async () => {
  const { page } = nobody
  await page.goto(`${WEB}/pos/${storeId}`)
  await page.waitForURL('**/pos/login')
  check('guard: /pos redirects a signed-out visitor to the register sign-in', true)
  await page.getByLabel('Email').fill(noAccessEmail)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  // This account owns its own store, so /pos sends it there; it has no role at the store under test.
  await page.waitForURL((u) => /^\/pos\/[^/]+$/.test(u.pathname) && u.pathname !== '/pos/login')
  await page.goto(`${WEB}/pos/${storeId}`)
  await page.getByRole('alert').filter({ hasText: /not set up to use the register/ }).waitFor()
  check('guard: an account without the pos_sell permission gets a clear message, not a broken screen', true)
})
await nobody.ctx.close()

// ======================================================================================
// 3. The cashier's shift
// ======================================================================================
const cash = await newSession('cashier')
const cp = cash.page
await step('cashier: sign in', cp, async () => {
  await cp.goto(`${WEB}/pos`)
  await cp.waitForURL('**/pos/login')
  await cp.getByLabel('Email').fill(cashierEmail)
  await cp.getByLabel('Password').fill('wrong-password')
  await cp.getByRole('button', { name: 'Sign in', exact: true }).click()
  await cp.getByRole('alert').filter({ hasText: 'Invalid credentials' }).waitFor()
  check('sign in: a wrong password shows a clear error', true)
  await cp.getByLabel('Password').fill(password)
  await cp.getByRole('button', { name: 'Sign in', exact: true }).click()
  await cp.waitForURL(`**/pos/${storeId}`)
  await cp.getByRole('heading', { name: 'Open the register' }).waitFor()
  check('sign in: the cashier lands on "Open the register" (no shift yet)', true)
  check('nav: a cashier sees Register and Sales but not the Daily summary', (await cp.getByRole('link', { name: 'Sales' }).count()) === 1 && (await cp.getByRole('link', { name: 'Daily summary' }).count()) === 0)
})

await step('cashier: open a shift', cp, async () => {
  await cp.getByLabel(/Starting cash/).fill('-5')
  await cp.getByRole('button', { name: 'Open shift' }).click()
  await cp.waitForTimeout(300)
  check('shift: a negative float is refused by the form', await cp.getByRole('heading', { name: 'Open the register' }).isVisible())
  await cp.getByLabel(/Starting cash/).fill('100')
  await cp.getByRole('button', { name: 'Open shift' }).click()
  await cp.getByLabel('Scan a barcode or search products').waitFor()
  await cp.getByText(/Shift open since/).waitFor()
  check('shift: opened with a 100.00 float; the register appears and the header shows the shift', true)
})

await step('cashier: scan, search and build a cart', cp, async () => {
  const search = cp.getByLabel('Scan a barcode or search products')
  check('register: the search field has focus, ready for a scanner', await search.evaluate((el) => el === document.activeElement))
  await cp.getByRole('button', { name: /^Widget \$/ }).waitFor()
  check('register: the product grid shows price and stock', (await cp.getByRole('button', { name: /^Widget \$20\.00 10 in stock/ }).count()) === 1)

  await search.fill('nomatch-zzz')
  await cp.getByText('No products found.').waitFor()
  await search.fill('scanner')
  await cp.getByRole('button', { name: /^Scanner Mug \$/ }).waitFor()
  check('register: typing part of a name filters the grid', (await cp.getByRole('button', { name: /^Widget \$/ }).count()) === 0)

  await search.fill(barcode)
  await search.press('Enter')
  await cp.getByText('Added Scanner Mug').waitFor()
  check('register: scanning a barcode (typed and Enter) adds the product straight to the sale', (await search.inputValue()) === '' && (await cp.getByText('Scanner Mug').count()) >= 1)
  await search.fill('0000000000000')
  await search.press('Enter')
  await cp.getByText(/No product with the code/).waitFor()
  check('register: an unknown code says so instead of doing nothing', true)

  await search.fill('')
  await cp.getByRole('button', { name: /^Widget \$/ }).click()
  await cp.getByRole('button', { name: /^Widget \$/ }).click()
  await cp.getByLabel('Increase Widget').waitFor()
  await cp.getByRole('button', { name: /^Gadget \$/ }).click()
  await cp.getByRole('button', { name: /^Gadget \$/ }).click()
  await cp.getByRole('button', { name: /^Gadget \$/ }).click()
  await cp.getByText('Only 2 in stock').waitFor()
  check('cart: asking for more than the shelf holds shows "Only 2 in stock"', true)
  check('cart: and Charge is disabled until it is fixed', await cp.getByRole('button', { name: /^Charge/ }).isDisabled())
  await cp.getByLabel('Decrease Gadget').click()
  await cp.getByText('Only 2 in stock').waitFor({ state: 'detached' })
  check('cart: back within stock the warning goes and Charge is available again', await cp.getByRole('button', { name: /^Charge/ }).isEnabled())
  await cp.getByLabel('Decrease Gadget').click()
  await cp.getByRole('button', { name: /^Charge \$62\.50/ }).waitFor()
  check('cart: subtotal comes from the server: 12.00 + 2 x 20.00 + 10.50 = 62.50', true)
})

await step('cashier: discount within and over the limit', cp, async () => {
  await cp.getByRole('button', { name: /^Discount/ }).click()
  await cp.getByLabel('Percent', { exact: true }).fill('50')
  await cp.getByRole('button', { name: 'Apply discount' }).click()
  await cp.getByRole('alert').filter({ hasText: /up to 10% off/ }).waitFor()
  check('discount: 50% is refused with the limit explained (cashier limit 10%)', true)
  await cp.getByLabel('Percent', { exact: true }).fill('10')
  await cp.getByLabel('Reason (optional)').fill('Loyal customer')
  await cp.getByRole('button', { name: 'Apply discount' }).click()
  await cp.getByRole('button', { name: /^Charge \$56\.25/ }).waitFor()
  check('discount: 10% is accepted; the total becomes 56.25', true)
})

await step('cashier: customer, hold and resume', cp, async () => {
  await cp.getByRole('button', { name: /^Customer/ }).click()
  await cp.getByRole('button', { name: 'Add a new customer' }).click()
  await cp.getByLabel('Name', { exact: true }).fill('Dana Lee')
  await cp.getByLabel('Email', { exact: true }).fill(`e2e-dana-${suffix}@example.com`)
  await cp.getByRole('button', { name: 'Add and select' }).click()
  await cp.getByRole('button', { name: /^Customer Dana Lee/ }).waitFor()
  check('customer: a new customer is added and attached to the sale', true)

  await cp.getByRole('button', { name: 'Hold', exact: true }).click()
  await cp.getByText('Scan a barcode or tap a product to start a sale.').waitFor()
  await cp.getByRole('button', { name: /^Held \(1\)/ }).waitFor()
  check('hold: the sale is parked, the register is empty and Held shows (1)', true)

  await cp.getByRole('button', { name: /^Held/ }).click()
  await cp.getByRole('heading', { name: 'Held sales' }).waitFor()
  await cp.getByText(/1 x Scanner Mug/).waitFor()
  check('hold: the held list names the items', (await cp.getByText(/1 x Scanner Mug/).count()) === 1)
  await cp.getByRole('button', { name: 'Resume' }).click()
  await cp.getByRole('button', { name: /^Charge \$56\.25/ }).waitFor()
  check('resume: the cart, discount and customer come back and are re-priced (56.25)', (await cp.getByRole('button', { name: /^Customer Dana Lee/ }).count()) === 1)
})

await step('cashier: split payment', cp, async () => {
  await shot(cp, 'register')
  check('register: fits the screen with no sideways scroll at 1440 wide', await noOverflow(cp))
  await cp.getByRole('button', { name: /^Charge/ }).click()
  await cp.getByRole('heading', { name: 'Payment' }).waitFor()
  const complete = cp.getByRole('button', { name: /^Complete sale/ })
  check('payment: starts as one cash payment for the whole total, ready to complete', await complete.isEnabled())

  await cp.getByLabel('Amount to pay').first().fill('10')
  check('payment: paying less than the total shows what is still due and blocks completion', (await cp.getByText('$46.25 still due').count()) === 1 && (await complete.isDisabled()))
  await cp.getByLabel('Cash received', { exact: true }).fill('20')
  await cp.getByText('Change to give').waitFor()
  check('payment: cash received 20.00 for a 10.00 cash payment shows change 10.00', (await cp.getByText('$10.00').count()) >= 1)
  await cp.getByRole('button', { name: 'Split payment' }).click()
  await cp.getByText('Fully paid').waitFor()
  check('payment: a split adds a card payment for the remaining 46.25 and the sale is fully paid', (await cp.getByLabel('Amount to pay').nth(1).inputValue()) === '46.25')
  await shot(cp, 'payment')
  await complete.click()
  await cp.getByRole('heading', { name: 'Sale complete' }).waitFor()
  check('sale: completes and shows the change to give (10.00)', (await cp.getByRole('status').filter({ hasText: 'Change to give' }).innerText()).includes('$10.00'))
})

await step('cashier: receipt', cp, async () => {
  const receipt = cp.getByRole('article', { name: /Receipt for sale 1/ }).first()
  const text = await receipt.innerText()
  check('receipt: shows the store, sale number, cashier and customer', text.includes(`POS Shop ${suffix}`) && text.includes('Sale #1') && text.includes('Riley Chen') && text.includes('Dana Lee'))
  check('receipt: lists each item with quantity and unit price', text.includes('Widget') && text.includes('2 x $20.00') && text.includes('Scanner Mug') && text.includes('Gadget'))
  check('receipt: subtotal, discount with its reason, tax and total', text.includes('$62.50') && /Discount \(Loyal customer\)/.test(text) && text.includes('-$6.25') && text.includes('$56.25'))
  check('receipt: cash received, card, and the change', text.includes('Cash') && text.includes('$20.00') && text.includes('Card') && text.includes('$46.25') && /Change\s*\$10\.00/.test(text))
  await shot(cp, 'sale-complete')
  await cp.getByRole('button', { name: 'Print receipt' }).click()
  check('print: pressing Print asks the browser to print', (await cp.evaluate(() => window.__prints)) === 1)
  const printCopy = await cp.evaluate(() => {
    const el = document.querySelector('body > .print-only')
    return el ? { display: getComputedStyle(el).display, hasReceipt: !!el.querySelector('article') } : null
  })
  check('print: a hidden copy of the receipt sits in <body> for the print stylesheet, invisible on screen', !!printCopy && printCopy.display === 'none' && printCopy.hasReceipt)
  await cp.emulateMedia({ media: 'print' })
  const printed = await cp.evaluate(() => ({
    root: getComputedStyle(document.getElementById('root')).display,
    copy: getComputedStyle(document.querySelector('body > .print-only')).display,
  }))
  await cp.emulateMedia({ media: 'screen' })
  check('print: when printing, the page is hidden and only the receipt shows', printed.root === 'none' && printed.copy === 'block', JSON.stringify(printed))
  await cp.getByRole('button', { name: 'New sale' }).click()
  await cp.getByText('Scan a barcode or tap a product to start a sale.').waitFor()
  await cp.getByRole('button', { name: /^Widget \$/ }).waitFor()
  check('after the sale: the register is empty and stock on the grid is updated (Widget 10 to 8)', (await cp.getByRole('button', { name: /^Widget \$20\.00 8 in stock/ }).count()) === 1)
})

await step('cashier: history and permissions', cp, async () => {
  await cp.getByRole('link', { name: 'Sales' }).click()
  await cp.getByRole('heading', { name: 'Sales history' }).waitFor()
  await cp.getByRole('row', { name: /#1/ }).waitFor()
  await cp.getByLabel(/Find a sale/).fill('dana')
  await cp.getByRole('row', { name: /#1.*Dana Lee/ }).waitFor()
  check('history: the sale is listed and found by customer name', true)
  await cp.getByLabel(/Find a sale/).fill('nobody-here')
  await cp.getByText('No sales found.').waitFor()
  await cp.getByLabel(/Find a sale/).fill('')
  await cp.getByRole('button', { name: 'Open sale 1' }).click()
  await cp.getByRole('heading', { name: 'Sale #1', exact: true }).waitFor()
  check('history: a cashier is told returns need a manager and has no return button', (await cp.getByText(/Returns need a manager/).count()) === 1 && (await cp.getByRole('button', { name: 'Return items' }).count()) === 0)
  await cp.getByRole('button', { name: 'Close', exact: true }).click()

  await cp.goto(`${WEB}/pos/${storeId}/summary`)
  await cp.getByRole('heading', { name: 'Open the register' }).or(cp.getByLabel('Scan a barcode or search products')).first().waitFor()
  check('summary: a cashier who opens the summary URL is sent back to the register', cp.url().endsWith(`/pos/${storeId}`))
})

await step('cashier: close the drawer (short by 10.00)', cp, async () => {
  await cp.getByRole('button', { name: 'Close shift' }).click()
  await cp.getByRole('heading', { name: 'Close shift' }).waitFor()
  await cp.getByLabel(/Cash counted/).fill('100')
  await cp.getByLabel('Note (optional)').fill('Miscounted change')
  await cp.getByRole('button', { name: 'Close shift' }).last().click()
  await cp.getByRole('heading', { name: 'Shift closed' }).waitFor()
  const text = await cp.getByRole('dialog').innerText()
  check('close: expected 110.00 (100 float + 10.00 cash), counted 100.00', /Expected in drawer\s*\$110\.00/.test(text) && /Counted\s*\$100\.00/.test(text))
  check('close: the drawer is reported short by 10.00', (await cp.getByText('The drawer is short by $10.00.').count()) === 1)
  await shot(cp, 'shift-closed')
  await cp.getByRole('button', { name: 'Done' }).click()
  await cp.getByRole('heading', { name: 'Open the register' }).waitFor()
  check('close: the register asks for a new shift afterwards', true)
})
await cash.ctx.close()

// ======================================================================================
// 4. The manager: returns, summary, and their own shift
// ======================================================================================
const mgr = await newSession('manager')
const mp = mgr.page
await step('manager: sign in and open a shift', mp, async () => {
  await mp.goto(`${WEB}/pos/login`)
  await mp.getByLabel('Email').fill(managerEmail)
  await mp.getByLabel('Password').fill(password)
  await mp.getByRole('button', { name: 'Sign in', exact: true }).click()
  await mp.waitForURL(`**/pos/${storeId}`)
  await mp.getByLabel(/Starting cash/).fill('50')
  await mp.getByRole('button', { name: 'Open shift' }).click()
  await mp.getByText(/Shift open since/).waitFor()
  check('manager: signs in and opens a shift with a 50.00 float', (await mp.getByRole('link', { name: 'Daily summary' }).count()) === 1)
})

await step('manager: partial return', mp, async () => {
  await mp.getByRole('link', { name: 'Sales' }).click()
  await mp.getByRole('button', { name: 'Open sale 1' }).click()
  await mp.getByRole('button', { name: 'Return items' }).click()
  await mp.getByRole('heading', { name: /Return items from sale #1/ }).waitFor()
  check('return: confirm is disabled until an item is chosen', await mp.getByRole('button', { name: 'Confirm return' }).isDisabled())
  await mp.getByLabel('Return more Scanner Mug').click()
  await mp.getByLabel('Return more Scanner Mug').click()
  check('return: the quantity cannot go above what was bought (1 of 1)', (await mp.getByText('1 of 1').count()) === 1)
  await mp.getByText('$10.80').first().waitFor()
  check('return: the refund is estimated with the discount taken off (12.00 less 10% = 10.80)', true)
  await mp.getByLabel('Reason (optional)').fill('Handle cracked')
  await shot(mp, 'return')
  await mp.getByRole('button', { name: 'Confirm return' }).click()
  await mp.getByRole('heading', { name: 'Sale #1', exact: true }).waitFor()
  await mp.getByText('Refunded in total').first().waitFor()
  const receipt = await mp.getByRole('article', { name: /Receipt for sale 1/ }).first().innerText()
  check('return: the receipt now lists the return (1 x Scanner Mug, -10.80)', /Returned/.test(receipt) && receipt.includes('1 x Scanner Mug') && receipt.includes('-$10.80'))
  await mp.getByRole('button', { name: 'Close', exact: true }).click()
  await mp.getByText('Part returned').waitFor()
  check('return: the list shows the sale as part returned', true)
})

await step('manager: return the rest', mp, async () => {
  await mp.getByRole('button', { name: 'Open sale 1' }).click()
  await mp.getByRole('button', { name: 'Return items' }).click()
  check('return: the returned item shows as all returned', (await mp.getByText('All returned').count()) === 1)
  await mp.getByLabel('Return more Widget').click()
  await mp.getByLabel('Return more Widget').click()
  await mp.getByLabel('Return more Gadget').click()
  await mp.getByRole('button', { name: 'card', exact: true }).click()
  await mp.getByText('$45.45').first().waitFor()
  check('return: the last units settle to the exact remainder (56.25 - 10.80 = 45.45)', true)
  await mp.getByRole('button', { name: 'Confirm return' }).click()
  await mp.getByRole('heading', { name: 'Sale #1', exact: true }).waitFor()
  await mp.getByText('Every item of this sale has been returned.').waitFor()
  check('return: once everything is back the sale is refunded and cannot be returned again', (await mp.getByRole('button', { name: 'Return items' }).count()) === 0)
  await mp.getByRole('button', { name: 'Close', exact: true }).click()
  await mp.getByRole('row', { name: /#1/ }).getByText('Refunded').waitFor()
  check('return: the list shows Refunded', true)
  await shot(mp, 'history')
})

await step('manager: daily summary', mp, async () => {
  await mp.getByRole('link', { name: 'Daily summary' }).click()
  await mp.getByRole('heading', { name: 'Daily summary' }).waitFor()
  await mp.getByText('Net sales').waitFor()
  const text = await mp.locator('main').innerText()
  check('summary: gross 56.25, refunds 56.25 (2 paid back), net 0.00, one sale', /Gross sales\s*\$56\.25/.test(text) && /Refunds\s*\$56\.25/.test(text) && /Net sales\s*\$0\.00/.test(text) && /Sales\s*1/.test(text) && text.includes('2 paid back'))
  check('summary: the split by payment method and cashier is there', text.includes('Cash') && text.includes('Card') && text.includes('Riley Chen'))
  check('summary: top items lists what was sold', text.includes('Widget'))
  check('summary: both shifts are listed, the closed one with its 10.00 shortage and the open one flagged', text.includes('-$10.00') && text.includes('Open'))
  check('summary: fits the screen', await noOverflow(mp))
  await shot(mp, 'summary')
  await mp.getByLabel('Day').fill('2000-01-01')
  await mp.getByText('Nothing was sold at the register on this day.').waitFor()
  check('summary: another day with no sales says so', true)
})

await step('manager: close their shift (balanced)', mp, async () => {
  await mp.getByRole('button', { name: 'Close shift' }).click()
  await mp.getByLabel(/Cash counted/).fill('39.20')
  await mp.getByRole('button', { name: 'Close shift' }).last().click()
  await mp.getByRole('heading', { name: 'Shift closed' }).waitFor()
  const text = await mp.getByRole('dialog').innerText()
  check('close: 50.00 float less 10.80 cash refunded (the card refund stays off the drawer) expects 39.20, and balances', /Expected in drawer\s*\$39\.20/.test(text) && (await mp.getByText('The drawer balances exactly.').count()) === 1)
})
await mgr.ctx.close()

// ======================================================================================
// 5. Smaller screens
// ======================================================================================
const tablet = await newSession('tablet', { width: 820, height: 1100 })
await step('tablet and phone layouts', tablet.page, async () => {
  const { page } = tablet
  await page.goto(`${WEB}/pos/login`)
  await page.getByLabel('Email').fill(ownerEmail)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL(`**/pos/${storeId}`)
  await page.getByRole('heading', { name: 'Open the register' }).waitFor()
  await page.getByRole('button', { name: 'Open shift' }).click()
  await page.getByLabel('Scan a barcode or search products').waitFor()
  await page.getByRole('button', { name: /^Widget \$/ }).click()
  await page.getByRole('button', { name: /^Charge/ }).waitFor()
  check('tablet (820 wide): register fits with the cart stacked under the products', await noOverflow(page))
  await shot(page, 'tablet')
  await page.setViewportSize({ width: 390, height: 844 })
  check('phone (390 wide): register still fits', await noOverflow(page))
  await page.getByRole('link', { name: 'Sales' }).click()
  await page.getByRole('heading', { name: 'Sales history' }).waitFor()
  check('phone (390 wide): the history table scrolls inside its own box, not the page', await noOverflow(page))
})
await tablet.ctx.close()
await owner.ctx.close()

check('no console errors or uncaught exceptions on any screen', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
await browser.close()
console.log(failures === 0 ? '\nAll browser checks passed.' : `\n${failures} browser check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
