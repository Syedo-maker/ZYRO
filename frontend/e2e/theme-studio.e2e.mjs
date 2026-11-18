// Store Themes, the owner's whole journey through the Theme Studio, in a real browser.
//
//   1. Only the owner sees "Theme" in the sidebar; a Manager does not, and the page refuses them.
//   2. The Studio shows the real storefront in a live preview, on desktop, tablet and mobile.
//   3. The assistant (Roman Urdu here) applies a look at once and offers recommendation cards; the
//      preview changes without reloading.
//   4. "Try this", Undo and Redo, and a quick action all work; each is a draft step.
//   5. The manual controls change the preview too.
//   6. A shopper never sees the draft: the storefront keeps the published look until Publish.
//   7. Finish and polish fixes the draft and lists what it fixed.
//   8. Publish makes it live; Versions lists it and can restore it.
//   9. A reply the AI cannot get right is retried once, then a plain message; nothing is charged,
//      and the controls keep working.
//  10. On a phone the tools are a bottom sheet.
// Screenshots go to e2e/shots/theme-studio/.
//
// Setup: the e2e server (backend/scripts/e2e-server.ts, its stand-in AI answers the design
// assistant) and `npm run dev` in the frontend, then: node e2e/theme-studio.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (emails and slugs use the e2e- prefix).
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
const SHOTS = new URL('./shots/theme-studio/', import.meta.url)
const shot = (name) => fileURLToPath(new URL(`${name}.png`, SHOTS))
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

const ownerEmail = `e2e-studio-${suffix}@example.com`
const reg = await api('POST', '/auth/register', { body: { email: ownerEmail, password: 'password123', storeName: 'E2E Studio Pottery', storeSlug: `e2e-studio-${suffix}`, currency: 'PKR' } })
if (reg.status !== 201) throw new Error(`register: ${reg.status}`)
const token = reg.json.accessToken
const storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
for (const [title, price] of [['Blue Glaze Mug', 900], ['Clay Teapot', 1800], ['Terracotta Planter', 1200], ['Hand-painted Plate', 950]]) {
  await api('POST', `/stores/${storeId}/products`, { token, body: { title, price, stock: 5, category: 'pottery' } })
}
const managerEmail = `e2e-studio-m-${suffix}@example.com`
await api('POST', `/stores/${storeId}/staff`, { token, body: { email: managerEmail, password: 'manager-pass-1', role: 'manager' } })
const generations = async () => (await api('GET', `/stores/${storeId}/ai-usage`, { token })).json.generationsUsed

const browser = await chromium.launch()

async function signIn(email, password, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${WEB}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /log in|sign in/i }).click()
  await page.waitForURL('**/admin/**')
  return { context, page, errors }
}

const frameOf = (page) => page.frameLocator('iframe[title^="Preview of your store"]')
/** The preview's page colour, read inside the frame. */
const previewBg = (page) =>
  page.locator('iframe[title^="Preview of your store"]').evaluate((f) => getComputedStyle(f.contentDocument.body).backgroundColor)
const waitPreviewBg = async (page, rgb) => {
  for (let i = 0; i < 40; i++) {
    if ((await previewBg(page).catch(() => '')) === rgb) return true
    await page.waitForTimeout(150)
  }
  return false
}
const shopperBg = async () => {
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.goto(`${WEB}/store/${storeId}`)
  await p.getByText('Blue Glaze Mug').first().waitFor()
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor)
  const html = await p.content()
  await ctx.close()
  return { bg, html }
}

try {
  // 1. Manager: no Theme entry, and the page says it is the owner's.
  const m = await signIn(managerEmail, 'manager-pass-1')
  check('a Manager has no Theme entry in the sidebar', (await m.page.getByRole('link', { name: 'Theme', exact: true }).count()) === 0)
  await m.page.goto(`${WEB}/admin/theme`)
  check('a Manager opening the Studio address is told it is the owner\'s', await m.page.getByText("Only the store owner can change the store's theme.").waitFor({ timeout: 8000 }).then(() => true, () => false))
  await m.context.close()

  // 2. The owner opens the Studio from the sidebar.
  const o = await signIn(ownerEmail, 'password123')
  const page = o.page
  await page.getByRole('link', { name: 'Theme', exact: true }).click()
  await page.getByRole('heading', { name: 'Theme', level: 1 }).waitFor()
  await frameOf(page).getByText('Blue Glaze Mug').first().waitFor()
  check('the Studio shows the real storefront in the preview', true)
  check('the storefront starts in its default look', await waitPreviewBg(page, 'rgb(3, 4, 7)'), await previewBg(page))
  // A marker inside the frame: if the frame reloads, it disappears.
  await page.locator('iframe[title^="Preview of your store"]').evaluate((f) => (f.contentWindow.__studioMarker = 'still-here'))

  // 3. Roman Urdu request: best guess applied, three cards, no reload.
  const before = await generations()
  await page.getByLabel('Describe the look you want').fill('Mujhe apni pottery shop ke liye warm handmade look chahiye')
  await page.getByRole('button', { name: 'Send' }).click()
  await page.getByText('Maine aap ki shop').waitFor()
  check('the assistant answers in Roman Urdu', true)
  const cards = page.getByRole('list', { name: 'Recommended looks' }).last().getByRole('listitem')
  check('two or three recommendation cards are offered', (await cards.count()) >= 2 && (await cards.count()) <= 3, String(await cards.count()))
  check('the best guess is applied to the preview at once', await waitPreviewBg(page, 'rgb(246, 239, 230)'), await previewBg(page))
  check('the preview changed without reloading', (await page.locator('iframe[title^="Preview of your store"]').evaluate((f) => f.contentWindow.__studioMarker)) === 'still-here')
  check('the request used exactly one AI generation', (await generations()) === before + 1)
  check('the status says the draft is not published', await page.getByText('Draft: not published yet').isVisible())
  await page.screenshot({ path: shot('assistant-recommendations') })

  // 4. Try another card, Undo, Redo, quick action.
  await cards.nth(1).getByRole('button', { name: 'Try this' }).click()
  check('"Try this" puts that look in the preview', await waitPreviewBg(page, 'rgb(255, 245, 249)'), await previewBg(page))
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Undo' }).click()
  check('Undo goes back to the previous look', await waitPreviewBg(page, 'rgb(246, 239, 230)'), await previewBg(page))
  await page.getByRole('button', { name: 'Redo' }).click()
  check('Redo brings it back', await waitPreviewBg(page, 'rgb(255, 245, 249)'), await previewBg(page))
  await page.getByRole('button', { name: 'Try a bolder look' }).click()
  await page.getByText('Electric night').waitFor()
  check('the bolder quick action gives a bolder look', await waitPreviewBg(page, 'rgb(10, 10, 10)'), await previewBg(page))

  // 5. Manual controls in the same panel.
  await page.getByRole('tab', { name: 'Customize' }).click()
  await page.getByRole('radiogroup', { name: 'Buttons' }).getByRole('radio', { name: 'Pill' }).click()
  let radius = ''
  for (let i = 0; i < 30 && radius !== '9999px'; i++) {
    await page.waitForTimeout(150)
    radius = await frameOf(page).getByRole('link', { name: 'Shop all products' }).evaluate((a) => getComputedStyle(a).borderTopLeftRadius).catch(() => '')
  }
  check('a manual control changes the preview (pill buttons)', radius === '9999px', radius)
  await page.getByLabel('Hero headline').fill('Clay, fire and patience')
  check('words typed show in the preview', await frameOf(page).getByRole('heading', { name: 'Clay, fire and patience' }).waitFor({ timeout: 5000 }).then(() => true, () => false))

  // Device sizes.
  for (const device of ['Tablet', 'Mobile', 'Desktop']) {
    await page.getByRole('group', { name: 'Device' }).getByRole('button', { name: device }).click()
    await page.waitForTimeout(200)
  }
  const frameWidth = await page.locator('iframe[title^="Preview of your store"]').evaluate((f) => f.contentWindow.innerWidth)
  check('the desktop preview is a true desktop width', frameWidth === 1280, String(frameWidth))
  await page.getByRole('group', { name: 'Page' }).getByRole('button', { name: 'Product' }).click()
  await frameOf(page).getByRole('heading', { level: 1 }).waitFor()
  check('the product page in the preview wears the draft', await waitPreviewBg(page, 'rgb(10, 10, 10)'), await previewBg(page))
  await page.getByRole('group', { name: 'Page' }).getByRole('button', { name: 'Home' }).click()
  await frameOf(page).getByText('Blue Glaze Mug').first().waitFor()
  await page.waitForTimeout(800) // let the headline save
  await page.screenshot({ path: shot('studio-desktop') })

  // 6. A shopper still sees the default look.
  let shopper = await shopperBg()
  check('a shopper does not see the draft', shopper.bg === 'rgb(3, 4, 7)' && !shopper.html.includes('Clay, fire and patience'), shopper.bg)

  // 7. Finish and polish, on a draft with real problems: products hidden, the hero not first, flat
  // cards on a flat page, and an accent that disappears into the background.
  const current = (await api('GET', `/stores/${storeId}/theme`, { token })).json.draft
  await api('PUT', `/stores/${storeId}/theme/draft`, {
    token,
    body: {
      theme: {
        ...current,
        surfaceStyle: 'flat',
        cardStyle: 'flat',
        colors: { ...current.colors, accent: '#0b0b0b' },
        sections: [{ id: 'about', visible: true }, { id: 'hero', visible: true }, { id: 'featured', visible: false }, { id: 'categories', visible: true }, { id: 'reviews', visible: true }],
      },
    },
  })
  await page.getByRole('button', { name: 'Finish and polish' }).click()
  const dialog = page.getByRole('dialog', { name: 'Finish and polish' })
  await dialog.getByText('Fixed', { exact: true }).waitFor()
  const polishText = await dialog.innerText()
  check('polish lists what it fixed', /hero to the top/.test(polishText) && /New arrivals/.test(polishText) && /thin border/.test(polishText) && /accent/.test(polishText), polishText.slice(0, 160))
  check('polish says nothing is live until Publish', /Nothing is live until you publish/.test(polishText))
  await page.screenshot({ path: shot('polish-summary') })
  const polished = (await api('GET', `/stores/${storeId}/theme`, { token })).json.draft
  check('the fixes are in the draft', polished.sections[0].id === 'hero' && polished.sections.find((s) => s.id === 'featured').visible && polished.cardStyle === 'bordered')

  // 8. Publish from the polish dialog.
  await dialog.getByRole('button', { name: 'Publish now' }).click()
  await page.getByText('Your theme is live').first().waitFor()
  check('publishing says it is live', true)
  check('the status now says Published', await page.getByText('Published', { exact: true }).isVisible())
  shopper = await shopperBg()
  check('shoppers see the published look', shopper.bg === 'rgb(10, 10, 10)' && shopper.html.includes('Clay, fire and patience'), shopper.bg)
  await page.getByRole('button', { name: 'Versions' }).click()
  const versions = page.getByRole('dialog', { name: 'Published versions' })
  await versions.getByText('Live now').waitFor()
  check('Versions lists the published version', (await versions.getByRole('button', { name: 'Restore' }).count()) === 1)
  await versions.getByRole('button', { name: 'Restore' }).click()
  await page.getByText('That version is now your draft').first().waitFor()
  check('restoring a version loads it as the draft', true)

  // 9. An unusable AI reply: retried once, then a plain message; nothing charged; controls still work.
  await page.getByRole('tab', { name: 'Assistant' }).click()
  const beforeBroken = await generations()
  await page.getByLabel('Describe the look you want').fill('broken please')
  await page.getByRole('button', { name: 'Send' }).click()
  await page.getByText('could not come up with a usable design').waitFor()
  check('an unusable AI reply ends in a plain message', true)
  check('and costs nothing', (await generations()) === beforeBroken)
  await page.getByRole('tab', { name: 'Customize' }).click()
  await page.getByRole('radiogroup', { name: 'Buttons' }).getByRole('radio', { name: 'Square' }).click()
  await page.waitForTimeout(800)
  const draft = (await api('GET', `/stores/${storeId}/theme`, { token })).json.draft
  check('the manual controls still work after the AI failed', draft.buttonStyle === 'square', draft.buttonStyle)
  check('no script errors in the Studio', o.errors.length === 0, o.errors.join(' | '))
  await o.context.close()

  // 10. Phone: the tools are a bottom sheet.
  const phone = await signIn(ownerEmail, 'password123', { width: 390, height: 844 })
  await phone.page.goto(`${WEB}/admin/theme`)
  await frameOf(phone.page).getByText('Blue Glaze Mug').first().waitFor()
  const sheet = phone.page.getByRole('button', { name: 'Design assistant and controls' })
  check('on a phone the tools open from a bottom sheet', await sheet.isVisible())
  await sheet.click()
  await phone.page.getByRole('tab', { name: 'Assistant' }).waitFor()
  const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check('the phone layout does not scroll sideways', overflow <= 0, String(overflow))
  await phone.page.screenshot({ path: shot('studio-mobile') })
  await phone.context.close()
} catch (err) {
  failures += 1
  console.log('FAIL  the journey stopped:', err.message)
} finally {
  await browser.close()
}

console.log(failures === 0 ? '\nAll Theme Studio checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
