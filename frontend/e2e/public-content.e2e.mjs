// The public website looks like a product: no student or university wording, no personal names, email
// addresses or phone numbers, no demo logins, and contact details say "coming soon" without links.
// Every public page, at desktop and 390px: visible text, the whole HTML (hidden text, alt text, link
// targets), the title and the meta tags. Also the code that writes the platform's emails.
//
// Setup: the e2e server and Vite on their usual ports. Afterwards run scripts/cleanup-test-data.ts.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { EMAIL, PHONE, findBanned } from './banned-public-terms.mjs'

const WEB = process.env.WEB ?? 'http://localhost:5173'
const API = `${WEB}/api/v1`
const ROOT = path.join(import.meta.dirname, '..', '..')
const suffix = Date.now().toString(36)
let failures = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
  if (!ok) failures += 1
}
async function api(method, p, { token, body } = {}) {
  const res = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text()
  return { status: res.status, json: t ? JSON.parse(t) : null }
}

const reg = await api('POST', '/auth/register', { body: { email: `e2e-pub-${suffix}@example.com`, password: 'password-for-e2e-1', storeName: `Clean Shop ${suffix}`, storeSlug: `e2e-pub-${suffix}`, currency: 'PKR' } })
const token = reg.json.accessToken
const storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
await api('POST', `/stores/${storeId}/products`, { token, body: { title: 'Clay Cup', price: 450, stock: 5, category: 'kitchen' } })

const PAGES = [
  ['landing', '/'], ['shop directory', '/shop'], ['login', '/login'], ['register', '/register'],
  ['forgot password', '/forgot-password'], ['reset password', '/reset-password?token=none'],
  ['terms', '/terms'], ['privacy', '/privacy'], ['contact', '/contact'], ['404 page', '/no-such-page'],
  ['unsubscribe', '/unsubscribe?t=none'], ['storefront', `/store/${storeId}`], ['storefront products', `/store/${storeId}/products`],
  ['shop policies', `/store/${storeId}/policies`], ['shop sign-in', `/store/${storeId}/account/login`], ['shop 404', `/store/${storeId}/no-such-page`],
]

const browser = await chromium.launch()
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['390px', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport, locale: 'en-US' })
    const page = await ctx.newPage()
    for (const [name, url] of PAGES) {
      await page.goto(WEB + url)
      await page.locator('#root > *').first().waitFor()
      // Until the shop has loaded, only its spinner is on the page.
      await page.waitForFunction(() => document.body.innerText.trim().length > 0 && !document.querySelector('[role="status"]'), null, { timeout: 15000 }).catch(() => {})
      const seen = await page.evaluate(() => ({
        title: document.title,
        meta: [...document.querySelectorAll('meta')].map((m) => m.getAttribute('content') ?? '').join('\n'),
        text: document.body.innerText,
        html: document.documentElement.outerHTML,
        hrefs: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
        sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      }))
      const everything = [seen.title, seen.meta, seen.text, seen.html, seen.hrefs.join('\n')].join('\n')
      const banned = findBanned(everything)
      check(`${label} ${name}: no banned wording or names`, banned.length === 0, banned.slice(0, 4).join(', '))
      const emails = [...new Set(everything.match(EMAIL) ?? [])]
      check(`${label} ${name}: no email address`, emails.length === 0, `${emails.length} found`)
      check(`${label} ${name}: no phone number`, !PHONE.test(seen.text))
      const contactLinks = seen.hrefs.filter((h) => /^(mailto|tel|sms|whatsapp):|wa\.me|facebook\.com|instagram\.com|linkedin\.com|twitter\.com|\/\/x\.com/i.test(h))
      check(`${label} ${name}: no contact or social links`, contactLinks.length === 0, contactLinks.slice(0, 2).join(', '))
      check(`${label} ${name}: fits the screen`, !seen.sideways)
    }
    // The landing footer.
    await page.goto(`${WEB}/`)
    const footer = page.locator('footer').last()
    await footer.waitFor()
    const text = (await footer.innerText()).replace(/\s+/g, ' ')
    for (const line of ['Email: coming soon', 'Contact: coming soon', 'Help center: coming soon', "Early access: we're building Zyro with feedback from store owners.", '© 2026 Zyro. All rights reserved.'])
      check(`${label} footer says "${line}"`, text.includes(line))
    check(`${label} footer: the coming-soon lines are plain text, not links`, (await footer.locator('a', { hasText: 'coming soon' }).count()) === 0)
    for (const [name, href] of [['Terms', '/terms'], ['Privacy', '/privacy'], ['Contact page', '/contact']])
      check(`${label} footer keeps its ${name} link`, (await footer.locator(`a[href="${href}"]`).count()) === 1)
    await ctx.close()
  }

  // Legal pages stay honest: still marked as templates, and contact says coming soon.
  const p = await browser.newPage()
  for (const url of ['/terms', '/privacy']) {
    await p.goto(WEB + url)
    await p.getByRole('heading', { level: 1 }).waitFor()
    check(`${url} is still marked as a template`, await p.getByRole('note').filter({ hasText: 'not yet been reviewed by a lawyer' }).isVisible())
    check(`${url} says the email is coming soon`, (await p.locator('main').innerText()).includes('Email: coming soon'))
  }
  await p.goto(`${WEB}/contact`)
  await p.getByRole('heading', { name: 'Contact', level: 1 }).waitFor()
  const contact = await p.locator('main').innerText()
  for (const line of ['Email: coming soon', 'Contact: coming soon', 'Help center: coming soon']) check(`contact page says "${line}"`, contact.includes(line))
} catch (err) {
  check('browser journey', false, err.message.split('\n')[0])
} finally {
  await browser.close()
}

// The emails the platform sends: every file that writes one.
for (const file of ['backend/src/modules/auth/passwordReset.service.ts', 'backend/src/modules/cart-recovery/cartRecovery.service.ts', 'backend/src/lib/email.ts', 'backend/src/lib/email.sendgrid.ts', 'backend/src/lib/email.brevo.ts']) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const banned = findBanned(src)
  const emails = [...new Set(src.match(EMAIL) ?? [])]
  check(`email code ${path.basename(file)}: no names, wording or addresses`, banned.length === 0 && emails.length === 0, [...banned, ...emails].slice(0, 3).join(', '))
}

console.log(failures === 0 ? '\nThe public site is clean.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
