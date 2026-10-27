// Storefronts wear their merchant's colour; the platform around them stays ZYRO's.
//
// What this proves, in a real browser:
//   1. A shop that picked a colour that already reads well is shown in exactly that colour.
//   2. A shop that picked a pale colour (white text on it would measure 1.4:1) is shown in a
//      deepened version of the same hue, and its buttons and brand-coloured text reach 4.5:1.
//   3. The platform's own screens keep ZYRO's green, so a merchant's colour never leaks out of their
//      shop (the dashboard, for one, is the same product for every merchant).
//   4. A shop with no colour falls back to ZYRO's.
//
// Setup: backend and Redis, `npm run dev` in the frontend, then: node e2e/brand-theme.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (emails and slugs use the e2e- prefix).
import { chromium } from 'playwright'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
const ZYRO_GREEN = 'rgb(11, 59, 51)' // --zyro-green-900
const suffix = Date.now().toString(36)
let failures = 0

const check = (label, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

async function api(method, p, { token, body } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text()
  return { status: res.status, json: t ? JSON.parse(t) : null }
}

async function shop(name, themeColor) {
  const reg = await api('POST', '/auth/register', {
    body: { email: `e2e-brand-${name}-${suffix}@example.com`, password: 'password123', storeName: `E2E Brand ${name}`, storeSlug: `e2e-brand-${name}-${suffix}`, currency: 'PKR' },
  })
  if (reg.status !== 201) throw new Error(`register ${name}: ${reg.status} ${JSON.stringify(reg.json)}`)
  const token = reg.json.accessToken
  const storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
  if (themeColor) {
    const r = await api('PATCH', `/stores/${storeId}/branding`, { token, body: { themeColor } })
    if (r.status !== 200) throw new Error(`branding ${name}: ${r.status}`)
  }
  await api('POST', `/stores/${storeId}/products`, { token, body: { title: 'Ceramic Chai Cup', price: 450, stock: 5, category: 'home and kitchen' } })
  return { storeId, token }
}

/** The brand colour as the browser resolved it, and the contrast of the primary button's text on it. */
const MEASURE = () => {
  const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d')
  const rgb = (css) => {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)]
  }
  const lum = (c) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
  }
  const ratio = (a, b) => {
    const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((m, n) => n - m)
    return (x + 0.05) / (y + 0.05)
  }
  const probe = document.createElement('span')
  probe.className = 'bg-brand text-on-brand'
  document.querySelector('main').appendChild(probe)
  const cs = getComputedStyle(probe)
  const out = {
    brand: cs.backgroundColor,
    onBrand: ratio(cs.color, cs.backgroundColor),
    brandOnPage: ratio(cs.backgroundColor, getComputedStyle(document.body).backgroundColor),
  }
  probe.remove()
  return out
}

const browser = await chromium.launch()
const page = await browser.newPage()
try {
  const deep = await shop('deep', '#4F46E5')
  const pale = await shop('pale', '#FFD400')
  const none = await shop('none', null)

  await page.goto(`${WEB}/store/${deep.storeId}`)
  await page.getByRole('heading', { level: 1 }).first().waitFor()
  let m = await page.evaluate(MEASURE)
  check('a colour that already reads well is used exactly', m.brand === 'rgb(79, 70, 229)', m.brand)

  await page.goto(`${WEB}/store/${pale.storeId}`)
  await page.getByRole('heading', { level: 1 }).first().waitFor()
  m = await page.evaluate(MEASURE)
  check('a pale colour is deepened, keeping its hue', m.brand === 'rgb(125, 104, 0)', m.brand)
  check('text on the deepened brand reaches 4.5:1', m.onBrand >= 4.5, m.onBrand.toFixed(2))
  check('brand-coloured text on the page reaches 4.5:1', m.brandOnPage >= 4.5, m.brandOnPage.toFixed(2))

  await page.goto(`${WEB}/store/${none.storeId}`)
  await page.getByRole('heading', { level: 1 }).first().waitFor()
  m = await page.evaluate(MEASURE)
  check('a shop with no colour wears ZYRO green', m.brand === ZYRO_GREEN, m.brand)

  // The platform: the pale shop's owner opens their dashboard, which must not wear their colour.
  await page.goto(`${WEB}/login`)
  await page.getByLabel('Email').fill(`e2e-brand-pale-${suffix}@example.com`)
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  await page.waitForURL(/\/admin/)
  await page.locator('main').waitFor()
  m = await page.evaluate(MEASURE)
  check("the merchant's dashboard keeps ZYRO green", m.brand === ZYRO_GREEN, m.brand)
} catch (err) {
  failures += 1
  console.log('FAIL ', err.message)
} finally {
  await browser.close()
}

console.log(failures ? `\n${failures} failed` : '\nAll passed')
process.exit(failures ? 1 : 0)
