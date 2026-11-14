// The toasts in a real browser (B3, 2026-11): saving and deleting a product, which used to give no sign
// it had worked, now confirm it with a toast that is announced to screen readers, closes from its button,
// stacks, leaves by itself after 4 to 5 seconds, waits while hovered, wears the success green (not the
// brand lime), simply appears when reduced motion is asked for, and fits a 390-pixel phone.
//
// Setup: the backend (npm run dev or the e2e server) and `npm run dev` in frontend, then:
//   node e2e/toasts.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (emails and slugs use the e2e- prefix).
import { chromium } from 'playwright'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
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

const email = `e2e-toasts-${suffix}@example.com`
const reg = await api('POST', '/auth/register', { body: { email, password: 'password123', storeName: `E2E Toasts ${suffix}`, storeSlug: `e2e-toasts-${suffix}` } })
const token = reg.json.accessToken
const storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
for (const title of ['Toast Mug', 'Toast Plate', 'Toast Bowl']) {
  await api('POST', `/stores/${storeId}/products`, { token, body: { title, price: 450, stock: 5, category: 'home and kitchen' } })
}

async function signIn(context) {
  const page = await context.newPage()
  await page.goto(`${WEB}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: /^log in$/i }).click()
  await page.waitForURL('**/admin/products', { timeout: 20000 })
  await page.getByRole('button', { name: 'Edit Toast Mug' }).first().waitFor({ timeout: 15000 })
  return page
}
async function rename(page, from, to) {
  await page.getByRole('button', { name: `Edit ${from}`, exact: true }).click()
  await page.getByLabel('Title', { exact: true }).fill(to)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
}
const toasts = (page) => page.getByRole('region', { name: 'Notifications' }).getByRole('listitem')

const browser = await chromium.launch()
try {
  const context = await browser.newContext()
  const page = await signIn(context)
  const problems = []
  page.on('pageerror', (e) => problems.push(e.message))
  page.on('dialog', (d) => void d.accept())

  // ---- Saved
  await rename(page, 'Toast Mug', 'Toast Mug Blue')
  const saved = toasts(page).filter({ hasText: 'Saved "Toast Mug Blue".' })
  await saved.waitFor({ timeout: 15000 })
  check('saving a product shows a toast that says so', true)
  check('the toast is a success toast', (await saved.getAttribute('data-toast')) === 'success')
  check('a screen reader hears it, from the polite live region', (await page.locator('[aria-live="polite"]').innerText()).includes('Saved "Toast Mug Blue".'))

  const colours = await saved.evaluate((el) => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-accent)'
    document.body.append(probe)
    const lime = getComputedStyle(probe).color
    probe.remove()
    return { text: getComputedStyle(el).color, lime }
  })
  check('the success green is not the brand lime', colours.text !== colours.lime, `${colours.text} vs ${colours.lime}`)

  await saved.getByRole('button', { name: 'Dismiss notification' }).click()
  await saved.waitFor({ state: 'detached', timeout: 5000 })
  check('its close button removes it', true)

  // ---- Deleted, and stacking
  await rename(page, 'Toast Bowl', 'Toast Bowl Large')
  await page.getByRole('button', { name: 'Delete Toast Plate' }).click()
  await toasts(page).filter({ hasText: 'Deleted "Toast Plate".' }).waitFor({ timeout: 15000 })
  check('deleting a product shows a toast that says so', true)
  check('two toasts stack, oldest first', (await toasts(page).allInnerTexts()).join('|').replace(/Done: /g, '').match(/Saved "Toast Bowl Large"\.[\s\S]*\|[\s\S]*Deleted "Toast Plate"\./) !== null, (await toasts(page).allInnerTexts()).join(' | '))

  // ---- Leaves by itself
  await page.mouse.move(5, 5)
  const started = Date.now()
  await toasts(page).first().waitFor({ state: 'detached', timeout: 8000 })
  const tookMs = Date.now() - started
  check('a toast leaves by itself after about 4 seconds', tookMs > 2500 && tookMs < 6500, `${tookMs} ms`)
  await page.getByRole('region', { name: 'Notifications' }).waitFor({ state: 'detached', timeout: 8000 })
  check('and the stack empties', true)

  // ---- Waits while hovered
  await rename(page, 'Toast Mug Blue', 'Toast Mug Red')
  const held = toasts(page).filter({ hasText: 'Saved "Toast Mug Red".' })
  await held.waitFor({ timeout: 15000 })
  await held.hover()
  await page.waitForTimeout(6000)
  check('a hovered toast stays past its time', (await held.count()) === 1)
  await page.mouse.move(5, 5)
  await held.waitFor({ state: 'detached', timeout: 8000 })
  check('and leaves once the pointer moves away', true)

  // ---- A toast that appears under a resting pointer still waits once the pointer moves on it.
  // The button the pointer rested on disappears and the new toast takes its place: the browser's
  // "mouse left that button" never reaches React (the button is gone), so React also misses the mouse
  // entering the toast. Moving the pointer over the toast must still hold it.
  // The form's Save button is scrolled to where the toast appears (bottom right), then clicked with the
  // mouse: the form closes, the button is gone, and the "Saved" toast appears under the resting pointer.
  await page.getByRole('button', { name: 'Edit Toast Bowl Large', exact: true }).click()
  await page.getByLabel('Title', { exact: true }).fill('Toast Bowl XL')
  // The form has finished loading: its AI tools section fetches the month's usage and grows when it
  // arrives, which moved the Save button after it had been placed.
  await page.getByText(/AI generations used this month/).waitFor()
  const save = page.getByRole('button', { name: 'Save', exact: true })
  const spot = await page.evaluate(() => ({ x: window.innerWidth - 16 - 384 / 2, y: window.innerHeight - 16 - 23 }))
  // The dashboard scrolls inside its own panel, not the window: bring the button into view first (any
  // scrolling box), then move whichever box holds it so the button sits where the toast will be.
  await save.scrollIntoViewIfNeeded()
  await save.evaluate((el, y) => {
    let box = el.parentElement
    while (box && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight)) box = box.parentElement
    const by = el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2 - y
    if (box) box.scrollTop += by
    else window.scrollBy(0, by)
  }, spot.y)
  const s = await save.boundingBox()
  const at = { x: Math.min(Math.max(spot.x, s.x + 4), s.x + s.width - 4), y: s.y + s.height / 2 }
  await page.mouse.click(at.x, at.y)
  const underPointer = toasts(page).filter({ hasText: 'Saved "Toast Bowl XL".' })
  await underPointer.waitFor({ timeout: 15000 })
  const t = await underPointer.boundingBox()
  const pointerOnToast = !!t && at.x >= t.x && at.x <= t.x + t.width && at.y >= t.y && at.y <= t.y + t.height
  await page.mouse.move(at.x - 2, at.y)
  await page.waitForTimeout(6000)
  check('the setup: the toast appeared under the resting pointer', pointerOnToast, JSON.stringify({ at, toast: t }))
  check('a toast that appears under a resting pointer waits once the pointer moves on it', (await underPointer.count()) === 1)
  await page.mouse.move(5, 5)
  await underPointer.waitFor({ state: 'detached', timeout: 8000 })

  check('no script errors', problems.length === 0, problems[0])

  // ---- Reduced motion, at phone width
  const phone = await signIn(await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }))
  await rename(phone, 'Toast Mug Red', 'Toast Mug Green')
  const small = toasts(phone).filter({ hasText: 'Saved "Toast Mug Green".' })
  await small.waitFor({ timeout: 15000 })
  const motion = await small.evaluate((el) => parseFloat(getComputedStyle(el).animationDuration) || 0)
  check('with reduced motion the toast appears without animating', motion < 0.05, `${motion}s`)
  const box = await small.boundingBox()
  check('on a 390-pixel phone it fits the screen with a margin', !!box && box.x >= 8 && box.x + box.width <= 382, box ? `${Math.round(box.x)} to ${Math.round(box.x + box.width)}` : 'no box')
  check('and the page does not scroll sideways', await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
} catch (err) {
  check('browser journey', false, err.message.split('\n')[0] + ' @ ' + (err.stack.split('\n').find((l) => l.includes('toasts.e2e')) ?? '').trim())
} finally {
  await browser.close()
}
console.log(failures ? `\n${failures} failed` : '\nAll passed')
process.exit(failures ? 1 : 0)
