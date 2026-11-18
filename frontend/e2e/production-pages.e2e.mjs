// The business pages of production readiness STEP 8, in a real browser at desktop and 390px:
// - the cookie notice (shown once, OK hides it for good, never on the dashboard);
// - the platform's Terms and Privacy marked as a template, and the contact page;
// - a shop's own policies, written in Settings from a template and read from the storefront footer
//   as plain text;
// - unsubscribing from cart reminders with a signed link;
// - page titles, canonical links, noindex on private pages, robots.txt and the sitemap.
//
// Setup: the e2e server and Vite on their usual ports (backend: npx tsx scripts/e2e-server.ts;
// frontend: npx vite). Afterwards run backend/scripts/cleanup-test-data.ts (e2e- prefix).
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { chromium } from 'playwright'

const WEB = process.env.WEB ?? 'http://localhost:5173'
const API = `${WEB}/api/v1`
const BACKEND = path.join(import.meta.dirname, '..', '..', 'backend')
const suffix = Date.now().toString(36)
let failures = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
  if (!ok) failures += 1
}

async function api(method, p, { token, body } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text()
  return { status: res.status, json: t && res.headers.get('content-type')?.includes('json') ? JSON.parse(t) : t }
}

async function shop(tag) {
  const email = `e2e-pp-${tag}-${suffix}@example.com`
  const reg = await api('POST', '/auth/register', { body: { email, password: 'password123', storeName: `Pages ${tag} ${suffix}`, storeSlug: `e2e-pp-${tag}-${suffix}`, currency: 'PKR' } })
  const token = reg.json.accessToken
  const storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
  await api('POST', `/stores/${storeId}/products`, { token, body: { title: 'Clay Chai Cup', price: 450, stock: 10, category: 'kitchen' } })
  return { email, token, storeId }
}

/** A signed unsubscribe link, made by the backend's own helper with the same settings as the e2e server. */
function unsubscribeToken(storeId, userId) {
  // Both ids are checked to be plain [a-z0-9] before they reach the command line.
  if (![storeId, userId].every((id) => /^[a-z0-9]{10,40}$/.test(id))) throw new Error('unexpected id')
  const out = execFileSync('npx', ['tsx', 'scripts/e2e-unsubscribe-token.ts', storeId, userId], { cwd: BACKEND, encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'ignore'] })
  return out.trim().split('\n').pop()
}

const owner = await shop('owner')
const bare = await shop('bare')
const browser = await chromium.launch()
const errors = []
const expected = /Failed to load resource: the server responded with a status of (400|401|404)/
async function page(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ locale: 'en-US', viewport })
  const p = await ctx.newPage()
  p.on('console', (m) => m.type() === 'error' && !expected.test(m.text()) && errors.push(m.text()))
  p.on('pageerror', (e) => errors.push(`pageerror ${e.message}`))
  return p
}
const wide = (p) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
const meta = (p, sel) => p.evaluate((s) => document.head.querySelector(s)?.getAttribute('content') ?? document.head.querySelector(s)?.getAttribute('href') ?? null, sel)

try {
  // ---- Cookie notice ----
  const v = await page()
  await v.goto(`${WEB}/`)
  const notice = v.getByRole('complementary', { name: 'Cookies' })
  await notice.waitFor()
  check('cookie notice: shown to a first-time visitor, saying there is no tracking', /No advertising or tracking/.test(await notice.innerText()))
  await notice.getByRole('button', { name: 'OK' }).click()
  check('cookie notice: OK hides it', (await notice.count()) === 0)
  await v.reload()
  await v.getByRole('heading').first().waitFor()
  check('cookie notice: stays hidden after a reload', (await v.getByRole('complementary', { name: 'Cookies' }).count()) === 0)

  // ---- Platform legal pages ----
  await v.goto(`${WEB}/privacy`)
  await v.getByRole('heading', { name: 'Privacy Policy', level: 1 }).waitFor()
  check('privacy: marked as a template not yet reviewed by a lawyer', await v.getByRole('note').filter({ hasText: 'not yet been reviewed by a lawyer' }).isVisible())
  check('privacy: its own title', (await v.title()) === 'Privacy Policy | ZYRO')
  check('privacy: lists the browser storage, including the theme and recently viewed product', await v.getByText(/dark or light colours, and in a shop, the product you looked at last/).isVisible())
  await v.goto(`${WEB}/terms`)
  await v.getByRole('heading', { name: 'Terms of Service', level: 1 }).waitFor()
  check('terms: marked as a template too', await v.getByRole('note').isVisible())
  await v.goto(`${WEB}/contact`)
  await v.getByRole('heading', { name: 'Contact', level: 1 }).waitFor()
  check('contact: no template note (it is not a legal text)', (await v.getByRole('note').count()) === 0)
  check('contact: tells shoppers to ask the shop first, and how to report a shop', (await v.getByRole('heading', { name: /question about an order/ }).isVisible()) && (await v.getByRole('heading', { name: /Report a shop/ }).isVisible()))

  // ---- A shop's policies: written in Settings from a template ----
  const o = await page()
  await o.goto(`${WEB}/login`)
  await o.getByLabel('Email').fill(owner.email)
  await o.getByLabel('Password').fill('password123')
  await o.getByRole('button', { name: 'Log in' }).click()
  await o.waitForURL('**/admin/**')
  const noindex = await o.waitForFunction(() => document.head.querySelector('meta[name="robots"]')?.getAttribute('content') === 'noindex', null, { timeout: 10_000 }).then(() => true, () => false)
  check('dashboard: marked noindex', noindex)
  check('dashboard: no cookie notice for merchants', (await o.getByRole('complementary', { name: 'Cookies' }).count()) === 0)
  await o.goto(`${WEB}/admin/settings`)
  const panel = o.getByRole('region', { name: 'Shop policies' })
  await panel.waitFor()
  await panel.getByRole('tab', { name: /Shipping and delivery/ }).click()
  await panel.getByRole('button', { name: 'Start from a template' }).click()
  const text = await panel.getByLabel('Shipping and delivery').inputValue()
  check('settings: the template opens with the lawyer note and names the shop', text.startsWith('TEMPLATE: have a lawyer review this') && text.includes(`Pages owner ${suffix}`))
  check('settings: it warns while the template note is still there', await panel.getByText(/still has the template note or a \[placeholder\]/).isVisible())
  const written = 'We deliver across Pakistan in 3 to 5 working days with TCS.\n\nCash on delivery everywhere. <b>Not bold</b>'
  await panel.getByLabel('Shipping and delivery').fill(written)
  check('settings: the warning goes once the text is the shop’s own', (await panel.getByText(/still has the template note/).count()) === 0)
  await panel.getByRole('button', { name: 'Save policy' }).click()
  await panel.getByText('Shipping and delivery is saved and shown on your shop.').waitFor()
  check('settings: saved', true)

  // ---- ...and read on the storefront ----
  const s = await page()
  await s.goto(`${WEB}/store/${owner.storeId}`)
  await s.getByRole('link', { name: 'Shop policies' }).waitFor()
  check('storefront: its title is the shop’s name', (await s.title()) === `Pages owner ${suffix}`)
  check('storefront: canonical link is the page without its query', (await meta(s, 'link[rel="canonical"]')) === `${WEB}/store/${owner.storeId}`)
  check('storefront: indexable (no noindex)', (await meta(s, 'meta[name="robots"]')) === null)
  check('storefront: with card payment set up, the footer says "Secure checkout by Stripe"', await s.getByText('Secure checkout by Stripe').isVisible())
  await s.getByRole('link', { name: 'Shop policies' }).click()
  await s.getByRole('heading', { name: 'Shop policies', level: 1 }).waitFor()
  const section = s.getByRole('region', { name: 'Shipping and delivery' })
  check('policies page: shows the shop’s text, paragraphs kept', /3 to 5 working days with TCS\.\s+Cash on delivery everywhere/.test(await section.innerText()))
  check('policies page: markup is shown as text, never run as HTML', (await section.locator('b').count()) === 0 && (await section.innerText()).includes('<b>Not bold</b>'))
  check('policies page: a policy not written is not shown', (await s.getByRole('region', { name: 'Returns and refunds' }).count()) === 0)
  await s.goto(`${WEB}/store/${bare.storeId}/policies`)
  await s.getByText(/has not published its policies yet/).waitFor()
  check('policies page: a shop with none says so, and links ZYRO’s privacy policy', await s.getByRole('link', { name: 'ZYRO privacy policy' }).isVisible())
  await s.goto(`${WEB}/store/${owner.storeId}/cart`)
  await s.getByRole('heading', { name: 'Your cart' }).waitFor()
  check('cart: marked noindex', (await meta(s, 'meta[name="robots"]')) === 'noindex')

  // ---- Unsubscribe ----
  const shopper = await api('POST', '/auth/register-customer', { body: { email: `e2e-pp-shopper-${suffix}@example.com`, password: 'password123' } })
  const token = unsubscribeToken(owner.storeId, shopper.json.user.id)
  const u = await page()
  await u.goto(`${WEB}/unsubscribe?t=${token}`)
  await u.getByRole('button', { name: 'Stop these emails' }).waitFor()
  check('unsubscribe: opening the link only asks, it names the shop', await u.getByText(new RegExp(`Stop these reminders from Pages owner ${suffix}\\?`)).isVisible())
  check('unsubscribe: the page is noindex', (await meta(u, 'meta[name="robots"]')) === 'noindex')
  const before = await api('GET', `/unsubscribe?t=${token}`)
  check('unsubscribe: still subscribed until the button is pressed', before.json.unsubscribed === false)
  await u.getByRole('button', { name: 'Stop these emails' }).click()
  await u.getByText(`You will not get any more cart reminders from Pages owner ${suffix}.`).waitFor()
  check('unsubscribe: confirmed', (await api('GET', `/unsubscribe?t=${token}`)).json.unsubscribed === true)
  await u.getByRole('button', { name: /Changed your mind/ }).click()
  await u.getByRole('button', { name: 'Stop these emails' }).waitFor()
  check('unsubscribe: the same link turns them back on', (await api('GET', `/unsubscribe?t=${token}`)).json.unsubscribed === false)
  await u.goto(`${WEB}/unsubscribe?t=${token.slice(0, -1)}x`)
  await u.getByText(/This unsubscribe link is not valid/).waitFor()
  check('unsubscribe: an altered link is refused with a way out', true)

  // ---- robots.txt and the sitemap, at the site root ----
  const robots = await fetch(`${WEB}/robots.txt`)
  check('robots.txt: served at the root (a development copy keeps everything out)', robots.status === 200 && /User-agent: \*\nDisallow: \//.test(await robots.text()))
  const sitemap = await fetch(`${WEB}/sitemap.xml`)
  check('sitemap.xml: served at the root as a sitemaps.org urlset', sitemap.status === 200 && (await sitemap.text()).includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'))

  // ---- 390px ----
  const m = await page({ width: 390, height: 844 })
  await m.goto(`${WEB}/store/${owner.storeId}/policies`)
  await m.getByRole('heading', { name: 'Shop policies', level: 1 }).waitFor()
  const mNotice = m.getByRole('complementary', { name: 'Cookies' })
  check('390px: the cookie notice shows and fits', (await mNotice.isVisible()) && !(await wide(m)))
  const box = await mNotice.boundingBox()
  check('390px: the notice leaves room for the assistant button on the right', box !== null && box.x + box.width <= 390 - 64, JSON.stringify(box))
  check('390px: policies page fits', !(await wide(m)))
  await m.goto(`${WEB}/contact`)
  await m.getByRole('heading', { name: 'Contact', level: 1 }).waitFor()
  check('390px: contact page fits', !(await wide(m)))
  await m.goto(`${WEB}/unsubscribe?t=${token}`)
  await m.getByRole('button', { name: 'Stop these emails' }).waitFor()
  check('390px: unsubscribe page fits', !(await wide(m)))

  check('no console errors or uncaught exceptions', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (err) {
  failures += 1
  console.log('FAIL  the journey stopped:', err.message.split('\n')[0])
} finally {
  await browser.close()
}
console.log(failures === 0 ? '\nAll production page checks passed.' : `\n${failures} browser check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
