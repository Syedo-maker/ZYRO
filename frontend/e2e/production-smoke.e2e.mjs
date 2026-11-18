// The whole product once, against a production build, on a computer-sized and a phone-sized screen.
// Works on any address, so it can check a local rehearsal and a real deployment alike. It needs the
// demo data (backend: npm run seed:demo) and creates a few e2e- accounts and one store per screen size.
//
//   WEB=https://<site> node e2e/production-smoke.e2e.mjs
//
// API            the API's address, when the site does not forward /api itself
// EXPECT_SAME_SITE  the sign-in cookie's SameSite (Lax when forwarded, None when direct)
// SMOKE_SHOTS    a folder for screenshots (outside the repository)
// DEMO_PASSWORD  the demo accounts' private password on a hosted copy (from your terminal)
// UPLOADS_DEMO_ONLY  true when this deployment keeps uploads on a temporary disk
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const WEB = (process.env.WEB ?? 'http://localhost:5173').replace(/\/+$/, '')
const API = (process.env.API ?? `${WEB}/api/v1`).replace(/\/+$/, '')
const SAME_SITE = process.env.EXPECT_SAME_SITE ?? 'Lax'
const SHOTS = process.env.SMOKE_SHOTS
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || PUBLIC_PASSWORD
const PUBLIC_PASSWORD = 'Demo-Video-2026'
const UPLOADS_DEMO_ONLY = process.env.UPLOADS_DEMO_ONLY === 'true'
const demo = (who) => `video-${who}@demo.zyro.local`
const suffix = Date.now().toString(36)
const password = 'smoke-pass-123'
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

let failures = 0
let passes = 0
const check = (label, ok, detail = '') => {
  if (ok) passes += 1
  else failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}
async function api(method, p, { token, body, form } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json, text }
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeklEQVR4nO3PUQkAIBTAwJfBmKYzoiH8OITBAtzm7PV1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWPHYBk4TBDzDRWcMAAAAASUVORK5CYII=', 'base64')

// ---- Without a browser: what the hosts themselves must get right ----
const home = await fetch(`${WEB}/`)
const csp = home.headers.get('content-security-policy') ?? ''
check('the site is served with its security headers', home.status === 200 && /script-src 'self'/.test(csp) && home.headers.get('x-content-type-options') === 'nosniff' && /max-age=/.test(home.headers.get('strict-transport-security') ?? ''))
const deep = await fetch(`${WEB}/store/some-store/cart`)
check('a direct visit to an inner address opens the app, not a 404', deep.status === 200 && (await deep.text()).includes('id="root"'))
const robots = await fetch(`${WEB}/robots.txt`)
check('robots.txt comes from the API', robots.status === 200 && /User-agent: \*/.test(await robots.text()))
check('sitemap.xml comes from the API', (await fetch(`${WEB}/sitemap.xml`)).status === 200)
check('the API answers', (await api('GET', '/plans')).status === 200)
check('test-only API routes do not exist', (await api('GET', '/__e2e/last-email?to=a@example.com')).status === 404)
// The API's own address, when the browser can reach it. Through the site these paths are simply the app.
const API_ROOT = API.replace(/\/api\/v1$/, '')
if (API_ROOT !== WEB) {
  check('test-only routes do not exist', (await fetch(`${API_ROOT}/__e2e/last-email`)).status === 404 && (await fetch(`${API_ROOT}/__mock-gateway/pay`)).status === 404)
  check('metrics need their token', (await fetch(`${API_ROOT}/metrics`)).status === 404)
}
const bad = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' })
const badText = await bad.text()
check('an error says nothing about the code behind it', bad.status === 400 && !/node_modules|\.ts:|\.js:|stack/i.test(badText), badText.slice(0, 80))

const demoLogin = await api('POST', '/auth/login', { body: { email: demo('owner'), password: DEMO_PASSWORD } })
check('the demo owner can sign in', demoLogin.status === 200, String(demoLogin.status))
const demoToken = demoLogin.json?.accessToken
if (DEMO_PASSWORD !== PUBLIC_PASSWORD) check('the public demo password does not work here', (await api('POST', '/auth/login', { body: { email: demo('owner'), password: PUBLIC_PASSWORD } })).status === 401)
check('the site reports how uploads are kept', (await api('GET', '/site')).json?.uploadsDemoOnly === UPLOADS_DEMO_ONLY)
const demoStore = (await api('GET', '/users/me/stores', { token: demoToken })).json?.find((s) => s.slug === 'demo-scout-video-showcase')
const demoProducts = (await api('GET', `/stores/${demoStore?.id}/products?limit=5`)).json
const demoProduct = (demoProducts?.data ?? demoProducts?.items ?? demoProducts ?? [])[0]
check('the demo store has products', Boolean(demoProduct?.title))
const preview = await (await fetch(`${WEB}/store/${demoStore?.id}/products/${demoProduct?.id}`, { headers: { 'User-Agent': 'WhatsApp/2.24.8.78 A' } })).text()
check('a link shared on WhatsApp gets a preview', preview.includes('og:title') && preview.includes('og:image'))

const browser = await chromium.launch()
const problems = []
const expected = /Failed to load resource: the server responded with a status of (400|401|402|403|404|409|429|503)/

async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport, ignoreHTTPSErrors: Boolean(process.env.SMOKE_INSECURE_TLS), locale: 'en-US' })
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  page.on('console', (m) => { if (m.type() === 'error' && !expected.test(m.text())) problems.push(m.text()) })
  page.on('pageerror', (e) => problems.push(e.message))
  return page
}
async function signIn(page, email, pass) {
  await page.goto(`${WEB}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(pass)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  await page.waitForURL(/\/(admin|pos)/)
}
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const imageShown = (locator) => locator.evaluate((el) => new Promise((done) => {
  const ok = () => done(el.complete && el.naturalWidth > 0)
  if (el.complete) ok()
  else { el.addEventListener('load', ok); el.addEventListener('error', ok) }
}))

async function run(name, viewport) {
  const tag = `${name}-${suffix}`
  const owner = { email: `e2e-smoke-${tag}@example.com`, store: `Smoke ${name} ${suffix}`, slug: `e2e-smoke-${tag}` }
  const title = `Smoke Mug ${name}`
  const label = (s) => `${name}: ${s}`
  const shot = async (page, s) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}-${s}.png`) }).catch(() => undefined) }
  let current
  const step = async (s, page, fn) => {
    current = page
    try {
      await fn()
      await shot(page, s.replace(/\W+/g, '-'))
    } catch (err) {
      check(label(s), false, `${String(err.message).split('\n')[0]} at ${current.url()}`)
      await shot(current, `failed-${s.replace(/\W+/g, '-')}`)
    }
  }
  const op = await newPage(viewport)
  let token, storeId

  await step('landing page, light and dark', op, async () => {
    await op.goto(WEB)
    await op.getByRole('link', { name: 'Start your store free' }).first().waitFor()
    check(label('the landing page opens and fits'), await fits(op))
    await op.getByRole('complementary', { name: 'Cookies' }).getByRole('button', { name: 'OK' }).click()
    const background = () => op.evaluate(() => getComputedStyle(document.body).backgroundColor)
    const dark = await background()
    await op.getByRole('button', { name: 'Light theme' }).first().click()
    await op.waitForFunction((was) => getComputedStyle(document.body).backgroundColor !== was, dark)
    check(label('light mode changes the page'), true, await background())
    await shot(op, 'landing-light')
    await op.getByRole('button', { name: 'Dark theme' }).first().click()
    await op.waitForFunction((was) => getComputedStyle(document.body).backgroundColor === was, dark)
    check(label('dark mode comes back'), true)
  })

  await step('sign up', op, async () => {
    await op.goto(`${WEB}/register`)
    await op.getByLabel('Email').fill(owner.email)
    await op.getByLabel('Password', { exact: true }).fill(password)
    await op.getByLabel('Store name').fill(owner.store)
    await op.getByLabel('Store URL').fill(owner.slug)
    await op.getByLabel('Currency your prices are in').selectOption('PKR')
    await op.getByRole('button', { name: /Create/ }).click()
    await op.waitForURL('**/admin/**')
    check(label('a new owner signs up and reaches the dashboard'), true)
    token = (await api('POST', '/auth/login', { body: { email: owner.email, password } })).json?.accessToken
    storeId = (await api('GET', '/users/me/stores', { token })).json?.[0]?.id
    check(label('the new store exists'), Boolean(storeId))
    await api('PATCH', `/stores/${storeId}/payments/settings`, { token, body: { codEnabled: true, bankTransferEnabled: true, bankAccountName: 'Smoke Shop', bankAccountNumber: 'PK00SMOKE0001', bankName: 'Test Bank' } })
  })

  await step('sign in and stay signed in', op, async () => {
    const page = await newPage(viewport)
    current = page
    await signIn(page, owner.email, password)
    const cookie = (await page.context().cookies()).find((c) => c.httpOnly)
    check(label('sign-in sets a protected cookie'), Boolean(cookie?.secure) && cookie?.sameSite === SAME_SITE, `${cookie?.sameSite}, secure ${cookie?.secure}`)
    await page.goto(`${WEB}/admin/dashboard`)
    await page.getByRole('region', { name: 'AI usage this month' }).waitFor()
    check(label('still signed in after a reload'), true)
    await page.context().close()
  })

  await step('forgot password', op, async () => {
    const page = await newPage(viewport)
    current = page
    await page.goto(`${WEB}/login`)
    await page.getByRole('link', { name: 'Forgot password?' }).click()
    await page.getByRole('heading', { name: 'Forgot your password?' }).waitFor()
    await page.getByLabel('Email').fill(owner.email)
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await page.getByRole('status').filter({ hasText: 'If this email is registered' }).waitFor()
    check(label('forgot password answers'), true)
    await page.context().close()
  })

  await step('dashboard and AI quota', op, async () => {
    await op.goto(`${WEB}/admin/dashboard`)
    const meter = op.getByRole('region', { name: 'AI usage this month' })
    await meter.getByText('AI content generations').waitFor()
    check(label('the dashboard shows the AI quota'), await meter.getByText('Shopping assistant replies').isVisible())
    check(label('the dashboard fits'), await fits(op))
    await op.evaluate(() => localStorage.setItem('zyro-theme', 'light'))
    await op.reload()
    await meter.getByText('AI content generations').waitFor()
    await shot(op, 'dashboard-light')
    await op.evaluate(() => localStorage.setItem('zyro-theme', 'dark'))
  })

  await step('create and edit a product', op, async () => {
    await op.goto(`${WEB}/admin/categories`)
    await op.getByLabel('New category').fill('kitchen')
    await op.getByRole('button', { name: 'Add category' }).click()
    await op.getByText('kitchen').first().waitFor()
    await op.goto(`${WEB}/admin/products`)
    await op.getByRole('button', { name: 'Add product' }).first().click()
    await op.getByLabel('Category', { exact: true }).selectOption({ label: 'kitchen' })
    await op.getByLabel('Title', { exact: true }).fill(title)
    const notice = op.getByText(/Demo site: uploaded files may disappear/)
    if (UPLOADS_DEMO_ONLY) await notice.waitFor()
    else await op.waitForTimeout(500)
    check(label(UPLOADS_DEMO_ONLY ? 'uploads are marked demo-only' : 'uploads are not marked demo-only'), (await notice.count()) === (UPLOADS_DEMO_ONLY ? 1 : 0))
    await op.getByLabel('Price (MRP)').fill('1200')
    await op.getByLabel('Stock', { exact: true }).fill('20')
    await op.getByRole('button', { name: /^(Save|Create)/ }).click()
    await op.getByRole('button', { name: `Edit ${title}` }).first().waitFor()
    check(label('a product is created'), true)
    await op.getByRole('button', { name: `Edit ${title}` }).first().click()
    await op.getByLabel('Price (MRP)').fill('1500')
    await op.getByLabel('Product image file').setInputFiles({ name: 'mug.png', mimeType: 'image/png', buffer: png })
    await op.getByRole('button', { name: 'Remove image' }).waitFor()
    check(label('a product image uploads'), true)
    await op.getByRole('button', { name: /^(Save|Update)/ }).click()
    await op.getByText(/1,?500/).first().waitFor()
    check(label('the product is edited'), true)
  })

  await step('Theme Studio', op, async () => {
    await op.goto(`${WEB}/admin/theme`)
    await op.getByRole('heading', { name: 'Theme', level: 1 }).waitFor()
    await op.frameLocator('iframe[title^="Preview of your store"]').getByText(title).first().waitFor()
    check(label('Theme Studio previews the real store'), true)
  })

  const shopper = await newPage(viewport)
  const buy = async (page) => {
    await page.goto(`${WEB}/store/${storeId}`)
    const card = page.getByRole('listitem').filter({ hasText: title }).first()
    await card.waitFor()
    await card.getByRole('button', { name: /Add to cart/ }).click()
    await page.getByRole('link', { name: /Cart, 1 item/ }).waitFor()
    await page.goto(`${WEB}/store/${storeId}/cart`)
    await page.getByRole('heading', { name: 'Your cart' }).waitFor()
    await page.getByRole('link', { name: 'Proceed to checkout' }).click()
    await page.getByRole('heading', { name: 'Checkout' }).waitFor()
  }
  const deliver = async (page, who) => {
    await page.getByLabel(/full name/i).fill(who)
    await page.getByLabel(/phone/i).fill('03001234567')
    await page.getByLabel(/address/i).first().fill('12 Mall Road')
    await page.getByLabel(/city/i).fill('Lahore')
  }

  await step('storefront, cart and cash on delivery', shopper, async () => {
    await shopper.goto(`${WEB}/store/${storeId}`)
    const image = shopper.getByRole('listitem').filter({ hasText: title }).first().locator('img').first()
    await image.waitFor()
    check(label('the storefront shows the uploaded image'), await imageShown(image))
    check(label('the storefront fits'), await fits(shopper))
    await buy(shopper)
    check(label('checkout fits'), await fits(shopper))
    await shopper.getByRole('radio', { name: /cash on delivery/i }).check()
    await deliver(shopper, 'Ayesha Khan')
    await shopper.getByRole('button', { name: /place order/i }).click()
    await shopper.waitForURL('**/checkout/placed**')
    check(label('a cash-on-delivery order is placed'), shopper.url().includes('method=cod'))
  })

  await step('bank transfer and receipt', shopper, async () => {
    const page = await newPage(viewport)
    current = page
    await buy(page)
    await page.getByText('Bank or wallet transfer').click()
    await page.getByText(/PK00SMOKE0001/).waitFor()
    await deliver(page, 'Bilal Ahmed')
    await page.getByRole('button', { name: /Place order for/ }).click()
    await page.getByRole('heading', { name: /your order is placed/i }).waitFor()
    await page.getByLabel('Screenshot').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: png })
    await page.getByLabel('Amount you sent').fill('1500')
    await page.getByLabel(/Transfer reference/).fill(`TRX-${tag}`)
    await page.getByRole('button', { name: 'Send receipt' }).click()
    await page.getByText(/Your receipt has been sent to the shop/).waitFor()
    check(label('a bank-transfer receipt is sent'), true)
    await page.context().close()
    current = op
    await op.goto(`${WEB}/admin/payments`)
    const receipt = op.locator('img[alt^="Payment screenshot for order"]').first()
    await receipt.waitFor()
    check(label('the owner can open the receipt'), await imageShown(receipt))
  })

  await step('shopping assistant', shopper, async () => {
    const before = (await api('GET', `/stores/${storeId}/ai-usage`, { token })).json?.chatMessagesUsed
    await shopper.goto(`${WEB}/store/${storeId}`)
    await shopper.getByRole('button', { name: 'Open shopping assistant' }).click()
    const chat = shopper.getByRole('dialog', { name: 'Shopping assistant' })
    await chat.getByLabel('Your message').fill('Do you have any mugs?')
    await chat.getByRole('button', { name: 'Send' }).click()
    const down = chat.getByText(/temporarily unavailable/i)
    const reply = chat.getByText(/mug/i).nth(1)
    await down.or(reply).first().waitFor({ timeout: 90000 })
    const after = (await api('GET', `/stores/${storeId}/ai-usage`, { token })).json?.chatMessagesUsed
    if (await down.count()) check(label('without a working AI key the chatbot says so, and no quota is used'), after === before, `${before} then ${after}`)
    else check(label('the chatbot answers and the reply is counted'), after === before + 1, `${before} then ${after}`)
  })

  await step('demo owner and Product Scout', op, async () => {
    const page = await newPage(viewport)
    current = page
    await signIn(page, demo('owner'), DEMO_PASSWORD)
    await page.goto(`${WEB}/admin/dashboard`)
    const panel = page.getByRole('complementary', { name: 'Trending products' })
    await panel.waitFor()
    await panel.getByRole('listitem').first().waitFor()
    check(label('Product Scout shows trending products'), (await panel.getByRole('listitem').count()) > 0)
    await shot(page, 'product-scout')
    await page.goto(`${WEB}/store/${demoStore.id}`)
    const image = page.locator('main img').first()
    await image.waitFor()
    check(label('the demo store shows its pictures from the site'), (await imageShown(image)) && (await image.getAttribute('src')).includes('/demo-assets/'))
    await page.context().close()
  })

  await step('Manager', op, async () => {
    const page = await newPage(viewport)
    current = page
    await signIn(page, demo('manager'), DEMO_PASSWORD)
    await page.goto(`${WEB}/admin/products`)
    await page.getByText(demoProduct.title).first().waitFor()
    check(label('the Manager sees the products'), true)
    await page.goto(`${WEB}/admin/theme`)
    await page.getByText(/Only the store owner can change/).waitFor()
    check(label('the Manager cannot open Theme Studio'), true)
    await page.context().close()
  })

  await step('Cashier', op, async () => {
    const page = await newPage(viewport)
    current = page
    await signIn(page, demo('cashier'), DEMO_PASSWORD)
    await page.goto(`${WEB}/pos/${demoStore.id}`)
    const open = page.getByRole('heading', { name: 'Open the register' })
    const search = page.getByLabel('Scan a SKU or search products')
    await open.or(search).first().waitFor()
    if (await open.count()) {
      await page.getByLabel(/Starting cash/).fill('100')
      await page.getByRole('button', { name: 'Open shift' }).click()
    }
    await search.waitFor()
    check(label('the Cashier reaches the register'), true)
    await page.goto(`${WEB}/admin/categories`)
    await page.getByRole('status').filter({ hasText: 'Categories need the Products permission' }).waitFor()
    check(label('the Cashier is kept out of owner pages'), true)
    await page.context().close()
  })

  await shopper.context().close()
  await op.context().close()
}

await run('desktop', { width: 1440, height: 900 })
await run('phone', { width: 390, height: 844 })
await browser.close()

const blocked = problems.filter((p) => /Content Security Policy|Refused to/i.test(p))
check('the browser blocked nothing', blocked.length === 0, blocked[0])
check('the browser reported no errors', problems.length === 0, problems[0])
console.log(`\n${passes} checks passed, ${failures} failed`)
process.exit(failures ? 1 : 0)
