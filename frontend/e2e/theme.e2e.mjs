// Dark, Light and System in a real browser (B5, 2026-11): dark for a first visit; the choice applies at
// once, survives a reload and is there before the app's own code runs (no flash); System follows the
// device as it changes; the toggle works from the keyboard; a browser that refuses storage still
// works; on the light theme lime is only ever a fill with black text on it; a merchant's own colour
// stays readable; and both themes are photographed at 1440 and 390 pixels for review
// (e2e/shots/theme-*.png).
//
// Setup: the backend (npm run dev or the e2e server) and `npm run dev` in frontend, then:
//   node e2e/theme.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (emails and slugs use the e2e- prefix).
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
const SHOTS = path.join(import.meta.dirname, 'shots')
fs.mkdirSync(SHOTS, { recursive: true })
const suffix = Date.now().toString(36)
let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}
const api = async (method, p, { token, body } = {}) => {
  const res = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: await res.json().catch(() => null) }
}

const email = `e2e-theme-${suffix}@example.com`
const reg = await api('POST', '/auth/register', { body: { email, password: 'password123', storeName: `E2E Theme ${suffix}`, storeSlug: `e2e-theme-${suffix}` } })
const token = reg.json.accessToken
const storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
const product = (await api('POST', `/stores/${storeId}/products`, { token, body: { title: 'Ceramic Chai Cup', price: 450, stock: 5, category: 'home and kitchen' } })).json.id
await api('POST', `/stores/${storeId}/products`, { token, body: { title: 'Brass Lamp', price: 2500, stock: 0, category: 'home and kitchen' } })

const DARK_BG = 'rgb(3, 4, 7)'
const LIGHT_BG = 'rgb(244, 245, 240)'
const themeOf = (page) => page.evaluate(() => ({ attr: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor }))
const toggle = (page) => page.getByRole('group', { name: 'Theme' }).first()

// Every visible element drawn in lime: as text, as a border, or as a fill (with the text on it).
async function limeUse(page) {
  return page.evaluate(() => {
    const LIME = 'rgb(212, 255, 36)'
    const out = { text: [], border: [], fillWithLightText: [] }
    const name = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).split(' ').slice(0, 3).join('.')}`
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      const s = getComputedStyle(el)
      if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) continue
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      if (ownText && s.color === LIME) out.text.push(name(el))
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        if (parseFloat(s[`border${side}Width`]) > 0 && s[`border${side}Color`] === LIME) {
          out.border.push(name(el))
          break
        }
      }
      if (s.backgroundColor === LIME && ownText && s.color !== 'rgb(3, 4, 7)') out.fillWithLightText.push(`${name(el)} ${s.color}`)
    }
    return out
  })
}

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(e.message))

  // ---- First visit: dark
  await page.goto(`${WEB}/login`)
  await toggle(page).waitFor({ timeout: 15000 })
  let t = await themeOf(page)
  check('a first visit is dark', t.attr === 'dark' && t.bg === DARK_BG, JSON.stringify(t))
  check('the toggle shows Dark as chosen', (await toggle(page).getByRole('button', { name: 'Dark theme' }).getAttribute('aria-pressed')) === 'true')

  // ---- Light, and a reload
  await toggle(page).getByRole('button', { name: 'Light theme' }).click()
  t = await themeOf(page)
  check('choosing Light switches at once', t.attr === 'light' && t.bg === LIGHT_BG, JSON.stringify(t))
  check('the choice is saved in this browser', (await page.evaluate(() => localStorage.getItem('zyro-theme'))) === 'light')
  await page.reload()
  await toggle(page).waitFor()
  t = await themeOf(page)
  check('and is still light after a reload', t.attr === 'light' && t.bg === LIGHT_BG, JSON.stringify(t))
  check('the address bar colour follows', (await page.locator('meta[name="theme-color"]').getAttribute('content')) === '#f4f5f0')

  // ---- No flash: the theme is on the page before any of the app's code runs. (In development Vite
  // loads the stylesheet through the app's code too, so with that blocked there are no styles to
  // measure; the attribute and colour scheme are what the first paint uses once they arrive. The
  // production page, where the stylesheet is a <link> in the head, is checked by `npm run build`'s
  // output: see the B5 commit.)
  const bare = await ctx.newPage()
  await bare.route('**/src/main.tsx*', (route) => route.abort())
  await bare.goto(`${WEB}/login`)
  const early = await bare.evaluate(() => ({ attr: document.documentElement.dataset.theme, scheme: document.documentElement.style.colorScheme, app: document.getElementById('root').childElementCount }))
  check('the saved theme is on the page before the app has drawn anything (no flash of dark)', early.attr === 'light' && early.scheme === 'light' && early.app === 0, JSON.stringify(early))
  await bare.close()

  // ---- System follows the device, live
  await page.emulateMedia({ colorScheme: 'dark' })
  await toggle(page).getByRole('button', { name: 'Match my device' }).click()
  check('System on a dark device is dark', (await themeOf(page)).attr === 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  check('and turns light when the device does, without a reload', (await themeOf(page)).bg === LIGHT_BG)

  // ---- The keyboard
  await toggle(page).getByRole('button', { name: 'Dark theme' }).focus()
  await page.keyboard.press('Space')
  check('the toggle works from the keyboard', (await themeOf(page)).attr === 'dark')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  check('Tab moves to the next option and Enter picks it', (await themeOf(page)).attr === 'light')
  check('no script errors', problems.length === 0, problems[0])

  // ---- Storage refused
  const locked = await browser.newContext()
  await locked.addInitScript(() => {
    const refuse = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }
    Object.defineProperty(window, 'localStorage', { get: refuse })
  })
  const lp = await locked.newPage()
  const lockedErrors = []
  lp.on('pageerror', (e) => lockedErrors.push(e.message))
  await lp.goto(`${WEB}/login`)
  await toggle(lp).waitFor({ timeout: 15000 })
  check('a browser that refuses storage opens dark, with no error', (await themeOf(lp)).attr === 'dark' && lockedErrors.length === 0, lockedErrors[0])
  await toggle(lp).getByRole('button', { name: 'Light theme' }).click()
  check('and can still switch to light for the visit', (await themeOf(lp)).attr === 'light' && lockedErrors.length === 0, lockedErrors[0])
  await locked.close()

  // ---- Lime is only a fill on the light theme, on every kind of screen
  await page.goto(`${WEB}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: /^log in$/i }).click()
  await page.waitForURL('**/admin/products', { timeout: 20000 })
  for (const [label, url] of [
    ['landing', `${WEB}/`],
    ['dashboard', `${WEB}/admin/dashboard`],
    ['products', `${WEB}/admin/products`],
    ['storefront', `${WEB}/store/${storeId}`],
    ['product', `${WEB}/store/${storeId}/products/${product}`],
    ['404', `${WEB}/no-such-page`],
  ]) {
    await page.goto(url)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(400)
    const lime = await limeUse(page)
    const at = new URL(page.url()).pathname
    check(`light ${label}: no lime text, no lime lines, black text on every lime fill`, at === new URL(url).pathname && !lime.text.length && !lime.border.length && !lime.fillWithLightText.length, at !== new URL(url).pathname ? `ended at ${at}` : JSON.stringify(lime).slice(0, 300))
  }

  // ---- A merchant's colour on the light theme: a yellow that would vanish as text on white
  await api('PATCH', `/stores/${storeId}/branding`, { token, body: { themeColor: '#FFD400' } })
  await page.goto(`${WEB}/store/${storeId}`)
  await page.getByRole('link', { name: 'Ceramic Chai Cup' }).first().waitFor({ timeout: 15000 })
  const ink = await page.evaluate(() => {
    const probe = document.createElement('span')
    probe.className = 'text-brand-ink'
    document.querySelector('main').append(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    return c
  })
  check("a merchant's yellow becomes a darker ink for text on the light theme", ink !== 'rgb(255, 212, 0)' && ink !== 'rgb(3, 4, 7)', ink)

  // ---- Photographs of both themes, for review
  for (const theme of ['dark', 'light']) {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const shotCtx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' })
      await shotCtx.addInitScript((value) => localStorage.setItem('zyro-theme', value), theme)
      const sp = await shotCtx.newPage()
      for (const [label, url] of [
        ['landing', `${WEB}/`],
        ['login', `${WEB}/login`],
        ['sign-in', null],
        ['dashboard', `${WEB}/admin/dashboard`],
        ['products', `${WEB}/admin/products`],
        ['storefront', `${WEB}/store/${storeId}`],
        ['product', `${WEB}/store/${storeId}/products/${product}`],
        ['404', `${WEB}/no-such-page`],
      ]) {
        if (!url) {
          await sp.getByLabel('Email').fill(email)
          await sp.getByLabel('Password').fill('password123')
          await sp.getByRole('button', { name: /^log in$/i }).click()
          await sp.waitForURL('**/admin/products', { timeout: 20000 })
          continue
        }
        await sp.goto(url)
        await sp.waitForLoadState('networkidle')
        await sp.waitForTimeout(500)
        await sp.screenshot({ path: path.join(SHOTS, `theme-${theme}-${w}-${label}.png`) })
        if (w === 390) check(`${theme} ${label} at 390: no sideways scrolling`, await sp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      }
      await shotCtx.close()
    }
  }
} catch (err) {
  check('browser journey', false, err.message.split('\n')[0])
} finally {
  await browser.close()
}
console.log(failures ? `\n${failures} failed` : '\nAll passed')
process.exit(failures ? 1 : 0)
