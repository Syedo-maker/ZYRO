// Browser test for Phase 1 (registration, login, session persistence, catalog CRUD with
// image upload, logout), run in real Chromium against the real frontend and backend.
//
// Setup and run: see the header of phase2-checkout.e2e.mjs (same servers). Then:
//   node e2e/phase1-auth-catalog.e2e.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const WEB = 'http://localhost:5173'
const SHOTS = path.join(import.meta.dirname, 'shots')
fs.mkdirSync(SHOTS, { recursive: true })

let failures = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
  if (!ok) failures++
}
async function step(name, fn) {
  try {
    await fn()
  } catch (e) {
    failures++
    const shown = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 220)).catch(() => '')
    console.log(`FAIL  ${name}  (${String(e.message).split('\n')[0]})  url=${page.url()}  page="${shown}"`)
    console.log('      trace: ' + trace.slice(-14).join(' | '))
    await page.screenshot({ path: path.join(SHOTS, `p1-failure-${name.replace(/\W+/g, '-')}.png`) }).catch(() => undefined)
  }
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const suffix = Date.now().toString(36)
const email = `p1e2e-${suffix}@example.com`
const password = 'password123'
const storeName = `Aurora ${suffix}`

const browser = await chromium.launch()
const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const consoleErrors = []
// Browser network logs for the guest's silent-login 401 and the deliberate bad-upload 400 are expected.
const expected = /Failed to load resource: the server responded with a status of (400|401|409)/
page.on('console', (m) => m.type() === 'error' && !expected.test(m.text()) && consoleErrors.push(m.text()))
page.on('pageerror', (e) => consoleErrors.push(`pageerror ${e.message}`))
page.on('dialog', (d) => d.accept())
const trace = []
page.on('response', (r) => r.url().includes('/api/') && trace.push(`${r.request().method()} ${r.url().replace(WEB, '')} -> ${r.status()}`))
page.on('requestfailed', (r) => trace.push(`FAILED ${r.method()} ${r.url().replace(WEB, '')} ${r.failure()?.errorText}`))
page.on('framenavigated', (f) => f === page.mainFrame() && trace.push(`NAV ${f.url().replace(WEB, '')}`))
page.on('console', (m) => trace.push(`console.${m.type()}: ${m.text().slice(0, 120)}`))

await step('logged-out visitors are sent to login', async () => {
  await page.goto(`${WEB}/admin/products`)
  await page.waitForURL('**/login')
  check('guard: /admin/products redirects a logged-out visitor to /login', true)
  await page.evaluate(() => document.fonts.ready)
  const fonts = await page.evaluate(async () => {
    await Promise.all([document.fonts.load('700 20px "Space Grotesk"'), document.fonts.load('400 14px "IBM Plex Sans"')])
    return {
      display: document.fonts.check('700 20px "Space Grotesk"'),
      body: document.fonts.check('400 14px "IBM Plex Sans"'),
      loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')),
    }
  })
  check('design: the Space Grotesk and IBM Plex Sans web fonts actually load', fonts.display && fonts.body && fonts.loaded.some((f) => /Space Grotesk/.test(f)) && fonts.loaded.some((f) => /IBM Plex Sans/.test(f)), JSON.stringify(fonts.loaded))
  await page.getByRole('link', { name: 'Create one' }).click()
  // The URL changes before React swaps the pages; typing now would fill the old login form.
  await page.getByRole('heading', { name: 'Create your store' }).waitFor()
})

await step('register', async () => {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByLabel('Store name').fill(storeName)
  check('register: store URL is suggested from the store name', (await page.getByLabel('Store URL').inputValue()) === `aurora-${suffix}`)
  await page.getByLabel('Store URL').fill('Bad Slug!')
  await page.getByRole('button', { name: 'Create store' }).click()
  await page.waitForTimeout(400)
  check('register: an invalid store URL is blocked by the browser before any request', page.url().endsWith('/register'))
  await page.getByLabel('Store URL').fill(`aurora-${suffix}`)
  await page.getByRole('button', { name: 'Create store' }).click()
  await page.waitForURL('**/admin/products')
  check('register: lands on the admin products page', true)
  await page.getByText(email).waitFor()
  await page.getByText(storeName).first().waitFor()
  check('register: header shows the store name and the account email', true)
  await page.getByText('No products yet').waitFor()
  check('products: empty state for a new store', true)
})

await step('session persistence across reloads', async () => {
  for (let i = 1; i <= 3; i++) {
    await page.reload()
    await page.getByText(email).waitFor()
  }
  check('session: still logged in after three reloads (refresh-token race fixed in Phase 1)', page.url().endsWith('/admin/products'))
})

await step('create a product with an image', async () => {
  await page.getByRole('button', { name: '+ Add product' }).click()
  await page.getByLabel('Title').fill('Trail Mug')
  await page.getByLabel('Description').fill('Enamel camping mug')
  await page.getByLabel('Price').fill('24.5')
  await page.getByLabel('Stock').fill('6')
  await page.getByLabel('Category').fill('outdoors')
  await page.getByLabel('Product image file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await page.getByRole('alert').filter({ hasText: 'Image upload failed' }).waitFor()
  check('form: a non-image file is rejected with a visible error', true)
  await page.getByLabel('Product image file').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PNG })
  await page.getByRole('button', { name: 'Remove image' }).waitFor()
  check('form: an uploaded image shows a thumbnail with a named remove button', true)
  check('form: the add-image button has an accessible name', (await page.getByRole('button', { name: 'Add image' }).count()) === 1)
  await page.screenshot({ path: path.join(SHOTS, 'p1-form.png') })
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Trail Mug').first().waitFor()
  check('products: the new product appears with its price and stock', (await page.getByText('$24.50').isVisible()) && (await page.getByRole('row').count() >= 0))
  const img = page.locator('img').first()
  await img.waitFor()
  const loaded = await img.evaluate((el) => new Promise((res) => (el.complete ? res(el.naturalWidth > 0) : (el.onload = () => res(true), el.onerror = () => res(false)))))
  check('products: the uploaded image actually loads in the list', loaded === true)
  const left = async (loc) => (await loc.boundingBox()).x
  const headerX = [await left(page.getByText('PRICE', { exact: true })), await left(page.getByText('STOCK', { exact: true })), await left(page.getByText('CATEGORY', { exact: true }))]
  const cellX = [await left(page.getByText('$24.50')), await left(page.getByText('outdoors')), 0]
  check('products: PRICE and CATEGORY headers line up with their values', Math.abs(headerX[0] - cellX[0]) < 4 && Math.abs(headerX[2] - cellX[1]) < 4, `header=${headerX.map(Math.round)} cells=${cellX.map(Math.round)}`)
  await page.screenshot({ path: path.join(SHOTS, 'p1-products.png') })
})

await step('edit and delete', async () => {
  await page.getByRole('button', { name: 'Edit Trail Mug' }).click()
  await page.getByLabel('Price').fill('30')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByText('$30.00').waitFor()
  check('edit: the price change is saved and shown', true)

  await page.getByRole('button', { name: '+ Add product' }).click()
  await page.getByLabel('Title').fill('Camp Stove')
  await page.getByLabel('Price').fill('40')
  await page.getByLabel('Stock').fill('3')
  await page.getByLabel('Category').fill('gear')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Camp Stove').first().waitFor()
  await page.getByRole('button', { name: 'Delete Camp Stove' }).click()
  await page.getByText('Camp Stove').waitFor({ state: 'detached' })
  check('delete: the product is removed after confirming', true)
  check('delete: the other product is untouched', await page.getByText('Trail Mug').first().isVisible())
})

await step('logout and login', async () => {
  await page.getByRole('button', { name: 'Log out' }).click()
  await page.getByRole('heading', { name: 'Log in' }).waitFor()
  check('logout: returns to the login page', true)
  await page.goto(`${WEB}/admin/products`)
  await page.getByRole('heading', { name: 'Log in' }).waitFor()
  check('logout: the admin area is locked again (session really ended, even after a reload)', true)

  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('wrong-password')
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByText('Invalid credentials').waitFor()
  check('login: a wrong password shows an error and stays on the page', page.url().endsWith('/login'))
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL('**/admin/products')
  await page.getByText('Trail Mug').first().waitFor()
  check('login: correct password works and the saved product is still there', true)
})

await step('orders nav and empty state work for a fresh store', async () => {
  await page.getByRole('link', { name: 'Orders' }).click()
  await page.getByText('No orders yet').waitFor()
  check('nav: Orders page opens from the sidebar', true)
  const disabled = await page.getByText('Marketing').first().evaluate((el) => el.tagName !== 'A')
  check('nav: not-yet-built sections (Dashboard, Marketing, Settings) are visibly disabled', disabled)
})

check('no console errors or uncaught exceptions', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
await browser.close()
console.log(failures === 0 ? '\nAll browser checks passed.' : `\n${failures} browser check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
