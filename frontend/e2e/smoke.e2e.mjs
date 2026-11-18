// Smoke test for a production-style ZYRO: the containers from compose.yaml, reached only through the
// web container's front door, exactly as a visitor reaches the Azure deployment.
//
//   docker compose up -d --build
//   node frontend/e2e/smoke.e2e.mjs                 (BASE=https://<site> to point it elsewhere)
//
// It checks what only the assembled system can show: every container is up and healthy; the site
// is served with its security headers; the API answers through the proxy; a merchant stays signed
// in across a reload (the reason the site and API share one origin); a product image is served by
// Blob Storage; a bank-transfer receipt opens for the merchant through a signed link and not without
// one; the recommendation service answers; the browser reports no errors and no blocked content;
// and the API survives a restart.
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import path from 'node:path'

const BASE = (process.env.BASE ?? 'http://localhost:8080').replace(/\/+$/, '')
const API = `${BASE}/api/v1`
const LOCAL = BASE.startsWith('http://localhost') || BASE.startsWith('http://127.0.0.1')
const ROOT = path.resolve(import.meta.dirname, '../..')
const suffix = Date.now().toString(36)
let failures = 0

const check = (label, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}
const compose = (args) => execSync(`docker compose ${args}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(method, p, { token, guest, body, form } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (guest) headers['X-Guest-Session-Id'] = guest
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API}${p}`, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json, headers: res.headers }
}
// A real 64x64 PNG (a flat colour), so the browser has something to draw.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeklEQVR4nO3PUQkAIBTAwJfBmKYzoiH8OITBAtzm7PV1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWPHYBk4TBDzDRWcMAAAAASUVORK5CYII=',
  'base64',
)
const imageForm = () => {
  const f = new FormData()
  f.append('file', new Blob([png], { type: 'image/png' }), 'cup.png')
  return f
}

// ---- 1. The containers (local stack only) ----
if (LOCAL) {
  // A container that has just started reports "starting" until its first health check; give them a minute.
  const read = () => compose('ps -a --format json').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  let ps = read()
  for (let i = 0; i < 30 && ps.some((c) => c.Health === 'starting'); i++) {
    await sleep(2000)
    ps = read()
  }
  const state = (svc) => ps.find((c) => c.Service === svc)
  for (const svc of ['postgres', 'mongo', 'redis', 'api', 'worker', 'reco', 'web']) {
    const c = state(svc)
    check(`container ${svc} is up${c?.Health ? ' and healthy' : ''}`, c?.State === 'running' && (!c.Health || c.Health === 'healthy'), c ? `${c.State} ${c.Health ?? ''}`.trim() : 'missing')
  }
  const migrate = state('migrate')
  check('migrations ran to completion before the API started', migrate?.State === 'exited' && migrate?.ExitCode === 0, migrate ? `exit ${migrate.ExitCode}` : 'missing')
}

// ---- 2. The front door ----
let res = await fetch(`${BASE}/healthz`)
check('the web container answers its health check', res.status === 200)
res = await fetch(`${BASE}/`)
const html = await res.text()
check('the site is served', res.status === 200 && html.includes('id="root"'))
const csp = res.headers.get('content-security-policy') ?? ''
// Framing is same-origin only since Store Themes (the Theme Studio previews the real storefront in a
// frame on the same site); no other site may frame any page.
check('security headers: a Content-Security-Policy that allows scripts only from the site itself', /script-src 'self'/.test(csp) && /frame-ancestors 'self'/.test(csp))
check('security headers: same-origin framing only, no sniffing, HSTS', res.headers.get('x-frame-options') === 'SAMEORIGIN' && res.headers.get('x-content-type-options') === 'nosniff' && /max-age=/.test(res.headers.get('strict-transport-security') ?? ''))
check('text is compressed (gzip)', /gzip/.test((await fetch(BASE + '/', { headers: { 'Accept-Encoding': 'gzip' } })).headers.get('content-encoding') ?? ''))
check('index.html is always revalidated, so a release shows at once', /no-cache/.test(res.headers.get('cache-control') ?? ''))
const plans = await api('GET', '/plans')
check('the API answers through the proxy', plans.status === 200 && Array.isArray(plans.json?.plans))
check('every API answer carries a request id', /^[0-9a-f-]{36}$/.test(plans.headers.get('x-request-id') ?? ''))

// ---- 3. A merchant, a product with an image, payments switched on ----
const email = `smoke-${suffix}@example.com`
const password = 'smoke-pass-123'
const reg = await api('POST', '/auth/register', { body: { email, password, storeName: `Smoke ${suffix}`, storeSlug: `smoke-${suffix}`, currency: 'PKR' } })
check('a merchant can sign up', reg.status === 201, String(reg.status))
const token = reg.json?.accessToken
const storeId = (await api('GET', '/users/me/stores', { token })).json?.[0]?.id
const upload = await api('POST', `/stores/${storeId}/uploads/images`, { token, form: imageForm() })
check('a product image uploads to Blob Storage', upload.status === 201 && /\/public\/products\//.test(upload.json?.url ?? ''), upload.json?.url)
const product = (await api('POST', `/stores/${storeId}/products`, { token, body: { title: 'Smoke Test Cup', price: 450, stock: 10, category: 'kitchen', images: [upload.json?.url] } })).json
await api('PATCH', `/stores/${storeId}/payments/settings`, { token, body: { codEnabled: true, bankTransferEnabled: true, bankAccountName: 'Smoke', bankAccountNumber: 'PK00SMOKE0001', bankName: 'Test Bank' } })

// ---- 4. A shopper pays by bank transfer and sends in the receipt ----
const guest = `guest-smoke-${suffix}`
await api('POST', `/stores/${storeId}/cart/items`, { guest, body: { productId: product?.id, quantity: 1 } })
const order = await api('POST', `/stores/${storeId}/payments/orders`, { guest, body: { name: 'Ayesha Khan', phone: '03001234567', email: `smoke-shopper-${suffix}@example.com`, address: { line1: '12 Mall Road', city: 'Lahore', country: 'PK' }, method: 'bank_transfer' } })
check('a shopper can place a bank-transfer order', order.status === 201, String(order.status))
const receipt = await fetch(`${API}/stores/${storeId}/payments/orders/${order.json?.orderId}/proof-image`, { method: 'POST', headers: { 'X-Guest-Session-Id': guest }, body: imageForm() })
const rj = await receipt.json()
check('the receipt is stored privately and answered with a signed link', receipt.status === 201 && /^receipts\//.test(rj.key ?? '') && /[?&]sig=/.test(rj.url ?? ''))
check('without its signature the receipt is refused', [403, 404, 409].includes((await fetch(String(rj.url).split('?')[0])).status))
const proof = await api('POST', `/stores/${storeId}/payments/orders/${order.json?.orderId}/proof`, { guest, body: { imageKey: rj.key, declaredAmount: order.json?.total } })
check('the receipt is submitted (read back from Blob Storage)', proof.status === 201, `${proof.status} ${proof.json?.detail ?? ''}`)

// ---- 5. The recommendation service ----
const t0 = Date.now()
const recs = await api('GET', `/stores/${storeId}/products/${product?.id}/recommendations`)
check('recommendations answer through the API', recs.status === 200 && Array.isArray(recs.json?.data), `${recs.status} in ${Date.now() - t0} ms`)

// ---- 5b. Search engines and link previews, through nginx ----
const robots = await fetch(`${BASE}/robots.txt`)
check('robots.txt is served at the root (from the API, through nginx)', robots.status === 200 && /^User-agent: \*/m.test(await robots.text()))
const sitemap = await fetch(`${BASE}/sitemap.xml`)
check('sitemap.xml is served at the root', sitemap.status === 200 && (await sitemap.text()).includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'))
const preview = await (await fetch(`${BASE}/store/${storeId}/products/${product?.id}`, { headers: { 'User-Agent': 'WhatsApp/2.24.8.78 A' } })).text()
check("a link shared on WhatsApp gets the product's own preview (title, price, photo)", preview.includes('<meta property="og:title" content="Smoke Test Cup | Smoke ') && /og:description" content="Rs\s?450\./.test(preview) && /og:image" content="http[^"]+\/public\/products\//.test(preview), preview.slice(0, 120))
const human = await (await fetch(`${BASE}/store/${storeId}/products/${product?.id}`, { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile' } })).text()
check('a person opening the same link gets the app', human.includes('id="root"') && !human.includes('og:url'))

// ---- 6. In a real browser ----
const browser = await chromium.launch()
const page = await browser.newPage()
const problems = []
// Script errors and blocked content count. A request the app expects to be refused does not: on
// a first visit the sign-in page asks quietly whether a session exists, and is correctly told 401.
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 401/.test(m.text())) problems.push(m.text())
})
page.on('pageerror', (e) => problems.push(e.message))
try {
  await page.goto(`${BASE}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  await page.waitForURL(/\/admin/, { timeout: 30000 })
  check('the merchant signs in through the browser', true)

  await page.reload()
  await page.waitForLoadState('networkidle')
  check('the merchant is still signed in after a reload (the cookie works through the one origin)', /\/admin/.test(page.url()) && !(await page.getByLabel('Password').isVisible().catch(() => false)), page.url())

  await page.goto(`${BASE}/admin/payments`)
  const shot = page.locator('img[alt^="Payment screenshot for order"]').first()
  await shot.waitFor({ timeout: 30000 })
  await page.waitForFunction((el) => el.complete && el.naturalWidth > 0, await shot.elementHandle(), { timeout: 15000 })
  check("the receipt opens on the merchant's payments page (a signed Blob Storage link)", true)

  await page.goto(`${BASE}/store/${storeId}`)
  await page.getByText('Smoke Test Cup').first().waitFor({ timeout: 30000 })
  const loaded = await page.evaluate(() => [...document.images].some((i) => i.src.includes('/public/products/') && i.complete && i.naturalWidth > 0))
  check('the storefront shows the product image, served by Blob Storage', loaded)

  // A phone (390px): the shop, the product, the cart and checkout fit the screen, cookie notice included.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
  phone.on('pageerror', (e) => problems.push(e.message))
  const wide = () => phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  await phone.goto(`${BASE}/store/${storeId}`)
  await phone.getByText('Smoke Test Cup').first().waitFor({ timeout: 30000 })
  check('390px: the cookie notice shows on a first visit', await phone.getByRole('complementary', { name: 'Cookies' }).isVisible())
  check('390px: the shop fits the screen', !(await wide()))
  await phone.goto(`${BASE}/store/${storeId}/products/${product?.id}`)
  await phone.getByRole('heading', { name: 'Smoke Test Cup' }).waitFor({ timeout: 30000 })
  check('390px: the product page fits', !(await wide()))
  await phone.getByRole('button', { name: /Add to cart/i }).first().click()
  await phone.goto(`${BASE}/store/${storeId}/checkout`)
  await phone.getByRole('heading', { name: 'Checkout' }).waitFor({ timeout: 30000 })
  check('390px: checkout fits', !(await wide()))
  await phone.close()
} catch (err) {
  check('browser journey', false, err.message.split('\n')[0])
} finally {
  await browser.close()
}
const blocked = problems.filter((p) => /Content Security Policy|Refused to/i.test(p))
check('the browser blocked nothing (the Content-Security-Policy fits the app)', blocked.length === 0, blocked[0])
check('the browser reported no errors', problems.length === 0, problems[0])

// ---- 7. A restart, as a release or a platform move would cause (local stack only) ----
if (LOCAL) {
  const started = Date.now()
  compose('restart api')
  let back = false
  for (let i = 0; i < 60 && !back; i++) {
    await sleep(1000)
    back = (await api('GET', '/plans').catch(() => ({ status: 0 }))).status === 200
  }
  check('the API comes back by itself after a restart', back, `${((Date.now() - started) / 1000).toFixed(1)} s`)
  const log = compose('logs api')
  check('and the old process shut down cleanly first', /"msg":"shutdown complete"/.test(log))
  const relogin = await api('POST', '/auth/login', { body: { email, password } })
  check('data survived the restart', relogin.status === 200)
}

console.log(failures ? `\n${failures} failed` : '\nAll passed')
process.exit(failures ? 1 : 0)
