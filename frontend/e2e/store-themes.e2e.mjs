// Store Themes, Part 1: a shop wears its published theme; the platform keeps Zyro's.
//
// What this proves, in a real browser:
//   1. A shop with no published theme looks exactly as before (Zyro's dark page, pill buttons).
//   2. Publishing a preset changes the storefront through the design tokens only: the page colour,
//      the body font, the button shape, and the homepage sections in the owner's order.
//   3. A draft is never shown to shoppers: a saved but unpublished change is not on the storefront.
//   4. Checkout wears the theme too; the dashboard and the landing page do not.
//   5. No flash of Zyro's colours on a returning visit: the loading screen already wears the shop's.
//   6. Every pairing the storefront shows passes AA in the browser, for three different presets.
//
// Setup: the e2e server (backend/scripts/e2e-server.ts) and `npm run dev` in the frontend, then:
//   node e2e/store-themes.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (emails and slugs use the e2e- prefix).
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
const SHOTS = new URL('./shots/store-themes/', import.meta.url)
const suffix = Date.now().toString(36)
let failures = 0
mkdirSync(SHOTS, { recursive: true })

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

const reg = await api('POST', '/auth/register', {
  body: { email: `e2e-themes-${suffix}@example.com`, password: 'password123', storeName: 'E2E Themes Shop', storeSlug: `e2e-themes-${suffix}`, currency: 'PKR' },
})
if (reg.status !== 201) throw new Error(`register: ${reg.status} ${JSON.stringify(reg.json)}`)
const token = reg.json.accessToken
const storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
for (const [title, price] of [['Ceramic Chai Cup', 450], ['Clay Teapot', 1800], ['Hand-painted Plate', 950]]) {
  await api('POST', `/stores/${storeId}/products`, { token, body: { title, price, stock: 5, category: 'home and kitchen' } })
}
const presets = (await api('GET', `/stores/${storeId}/theme/options`, { token })).json.presets
const preset = (id) => structuredClone(presets.find((p) => p.id === id).theme)

async function publish(theme) {
  const saved = await api('PUT', `/stores/${storeId}/theme/draft`, { token, body: { theme } })
  if (saved.status !== 200) throw new Error(`draft: ${saved.status} ${JSON.stringify(saved.json)}`)
  const live = await api('POST', `/stores/${storeId}/theme/publish`, { token })
  if (live.status !== 200) throw new Error(`publish: ${live.status}`)
  return saved.json
}

/** Resolved colours, fonts and shapes on the storefront, and the worst contrast among text pairings. */
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
  const main = document.querySelector('main')
  const probe = (cls) => {
    const el = document.createElement('span')
    el.className = cls
    main.appendChild(el)
    const cs = getComputedStyle(el)
    const out = { color: cs.color, bg: cs.backgroundColor }
    el.remove()
    return out
  }
  const page = probe('bg-bg').bg
  const card = probe('bg-surface').bg
  const pairs = {
    'text on page': [probe('text-text').color, page],
    'text on card': [probe('text-text').color, card],
    'secondary on card': [probe('text-text-secondary').color, card],
    'muted on page': [probe('text-text-muted').color, page],
    'links on page': [probe('text-brand-ink').color, page],
    'button text': [probe('text-on-brand').color, probe('bg-brand').bg],
  }
  const button = [...document.querySelectorAll('main a')].find((a) => a.textContent.trim() === 'Shop all products')
  const headings = [...document.querySelectorAll('main h2')].map((h) => h.textContent.trim())
  return {
    page,
    font: getComputedStyle(document.body).fontFamily.split(',')[0].replaceAll('"', ''),
    buttonRadius: button ? getComputedStyle(button).borderTopLeftRadius : null,
    headings,
    worst: Object.entries(pairs)
      .map(([k, [a, b]]) => [k, Math.round(ratio(a, b) * 100) / 100])
      .sort((x, y) => x[1] - y[1])[0],
  }
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()

const openHome = async () => {
  await page.goto(`${WEB}/store/${storeId}`)
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.getByText('Ceramic Chai Cup').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
}

try {
  // 1. No theme yet: exactly as before.
  await openHome()
  let m = await page.evaluate(MEASURE)
  check('without a theme the shop keeps Zyro\'s dark page', m.page === 'rgb(3, 4, 7)', m.page)
  check('without a theme buttons stay pills', m.buttonRadius === '9999px', m.buttonRadius)
  check('without a theme the front page is unchanged (no reviews or about sections)', !m.headings.some((h) => /customers say|About/.test(h)), m.headings.join(' | '))

  // 2 and 6. Three presets, published one after another.
  const looks = [
    { id: 'clean-light', page: 'rgb(255, 255, 255)', font: 'Inter', radius: '6px' },
    { id: 'warm-earth', page: 'rgb(246, 239, 230)', font: 'Inter', radius: '12px' },
    { id: 'bold-contrast', page: 'rgb(10, 10, 10)', font: 'Poppins', radius: '2px' },
  ]
  for (const look of looks) {
    const theme = preset(look.id)
    theme.heroHeadline = `Handmade in Multan (${look.id})`
    theme.aboutText = 'A family pottery studio since 1984.'
    theme.sections = [
      { id: 'hero', visible: true },
      { id: 'about', visible: true },
      { id: 'featured', visible: true },
      { id: 'categories', visible: look.id !== 'bold-contrast' },
      { id: 'reviews', visible: true },
    ]
    await publish(theme)
    await openHome()
    m = await page.evaluate(MEASURE)
    check(`${look.id}: the page wears the theme's background`, m.page === look.page, m.page)
    check(`${look.id}: the body font is the theme's`, m.font === look.font, m.font)
    check(`${look.id}: the button shape follows the theme`, m.buttonRadius === look.radius, m.buttonRadius)
    // The chat button's glow is the shop's main colour, never Zyro's lime.
    const glow = await page.getByRole('button', { name: 'Open shopping assistant' }).evaluate((b) => getComputedStyle(b).boxShadow)
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(theme.colors.primary.slice(i, i + 2), 16))
    check(`${look.id}: the glow is the shop's colour, not Zyro's lime`, glow.includes(`${r}, ${g}, ${b}`) && !glow.includes('212, 255, 36'), glow.slice(0, 60))
    check(`${look.id}: every measured text pairing is AA or better`, m.worst[1] >= 4.5, `${m.worst[0]} ${m.worst[1]}`)
    check(`${look.id}: the hero says what the owner wrote`, (await page.getByRole('heading', { level: 1 }).textContent()).includes(look.id))
    const order = m.headings.filter((h) => /About|New arrivals|Shop by category/.test(h))
    const expected = look.id === 'bold-contrast' ? ['About E2E Themes Shop', 'New arrivals'] : ['About E2E Themes Shop', 'New arrivals', 'Shop by category']
    check(`${look.id}: sections appear in the owner's order, hidden ones left out`, JSON.stringify(order) === JSON.stringify(expected), order.join(' | '))
    check(`${look.id}: the visitor's Dark/Light switch is not offered on a themed shop`, (await page.getByRole('button', { name: /theme/i }).count()) === 0)
    await page.screenshot({ path: fileURLToPath(new URL(`storefront-${look.id}.png`, SHOTS)), fullPage: true })
  }

  // 3. A saved draft is not shown to shoppers.
  const draft = preset('soft-pastel')
  draft.heroHeadline = 'SECRET DRAFT HEADLINE'
  await api('PUT', `/stores/${storeId}/theme/draft`, { token, body: { theme: draft } })
  await openHome()
  check('a saved draft is not on the storefront', !(await page.content()).includes('SECRET DRAFT HEADLINE'))
  m = await page.evaluate(MEASURE)
  check('the storefront still wears the last published theme', m.page === 'rgb(10, 10, 10)', m.page)

  // 4. Checkout wears it; the platform does not.
  await page.goto(`${WEB}/store/${storeId}/checkout`)
  await page.locator('main').waitFor()
  const checkoutBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  check('checkout wears the shop theme', checkoutBg === 'rgb(10, 10, 10)', checkoutBg)
  await page.goto(`${WEB}/`)
  await page.locator('main').first().waitFor()
  const landing = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, vars: document.documentElement.style.cssText }))
  check('leaving the shop takes the theme off: the landing page is Zyro\'s', landing.vars === '' || !landing.vars.includes('--color-bg'), landing.vars.slice(0, 80))

  // 5. No flash: on a return visit the loading screen already wears the shop's colours.
  await publish(preset('clean-light'))
  await openHome() // caches the new theme
  await page.route(`${API}/stores/${storeId}`, async (route) => {
    await new Promise((r) => setTimeout(r, 1500))
    await route.continue()
  })
  await page.goto(`${WEB}/store/${storeId}`)
  await page.getByText('Loading store').waitFor()
  // On a failure, say which part broke: the cached colours, the colours on <html>, or the whole page
  // hidden behind the app's loading screen (a suspended React boundary).
  const loading = await page.evaluate((id) => ({
    bg: getComputedStyle(document.body).backgroundColor,
    cached: (localStorage.getItem(`zyro-store-theme:${id}`) ?? '').slice(0, 40),
    rootBg: document.documentElement.style.getPropertyValue('--color-bg'),
    hidden: [...document.querySelectorAll('#root > *')].filter((el) => el.style.display === 'none').length,
  }), storeId)
  check('the loading screen of a returning visit wears the shop background, not Zyro\'s', loading.bg === 'rgb(255, 255, 255)', JSON.stringify(loading))
  // Before any app code runs: the before-paint script has already put the shop's colour on <html>.
  await page.goto(`${WEB}/store/${storeId}`, { waitUntil: 'domcontentloaded' })
  const early = await page.evaluate(() => document.documentElement.style.getPropertyValue('--color-bg'))
  check('the shop colour is on the page before the app has even started', early === '#ffffff', early || '(none)')
  await page.unroute(`${API}/stores/${storeId}`)

  // Leaving the shop inside the app (no page load) takes its colours off the platform pages.
  await page.getByText('Ceramic Chai Cup').first().waitFor()
  await page.getByRole('link', { name: 'All shops' }).first().click()
  await page.waitForURL('**/shop')
  // React keeps the shop on screen until the next page's code has loaded, then swaps; give it that moment.
  const cleared = await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--color-bg') === '', null, { timeout: 8000 }).then(() => true, () => false)
  const after = await page.evaluate(() => document.documentElement.style.getPropertyValue('--color-bg'))
  check('following a link out of the shop leaves no shop colour on the platform', cleared, after || '(none)')
} catch (err) {
  failures += 1
  console.log('FAIL  the journey stopped:', err.message)
} finally {
  await browser.close()
}

console.log(failures === 0 ? '\nAll store theme checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
