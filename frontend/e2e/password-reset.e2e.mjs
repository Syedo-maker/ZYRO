// Forgot and reset password in a real browser (B1, 2026-11): the link on the login page, the forgot page's
// one answer for every email, the emailed link (read back from the e2e server's fake outbox), choosing a
// new password, the old one refused and the new one working, and a used link refused.
//
// Setup: Redis, `npx tsx scripts/e2e-server.ts` in backend (it keeps the emails it would send), and
// `npm run dev` in frontend, then:  node e2e/password-reset.e2e.mjs
// Afterwards run backend/scripts/cleanup-test-data.ts (emails and slugs use the e2e- prefix).
import { chromium } from 'playwright'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
const suffix = Date.now().toString(36)
const email = `e2e-reset-${suffix}@example.com`
let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}
const api = async (method, p, body) => {
  const res = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: await res.json().catch(() => null) }
}
async function lastEmail(to) {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`http://localhost:5000/__e2e/last-email?to=${encodeURIComponent(to)}`)
    if (res.ok) return res.json()
    await new Promise((r) => setTimeout(r, 100))
  }
  return null
}

await api('POST', '/auth/register', { email, password: 'old-password-1', storeName: `E2E Reset ${suffix}`, storeSlug: `e2e-reset-${suffix}` })

const browser = await chromium.launch()
const page = await browser.newPage()
const problems = []
page.on('pageerror', (e) => problems.push(e.message))
try {
  await page.goto(`${WEB}/login`)
  await page.getByRole('link', { name: 'Forgot password?' }).click()
  await page.getByRole('heading', { name: 'Forgot your password?' }).waitFor()
  check('the login page links to "Forgot password?"', page.url().endsWith('/forgot-password'))

  // An unknown email gets the same answer as a registered one.
  await page.getByLabel('Email').fill(`e2e-nobody-${suffix}@example.com`)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  const answer = page.getByRole('status').filter({ hasText: 'If this email is registered' })
  await answer.waitFor({ timeout: 15000 })
  const unknownText = await answer.innerText()

  await page.goto(`${WEB}/forgot-password`)
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await answer.waitFor({ timeout: 15000 })
  check('a registered and an unknown email get exactly the same answer', (await answer.innerText()) === unknownText, unknownText)

  const mail = await lastEmail(email)
  check('a reset email was sent to the registered address', !!mail, mail?.subject)
  const link = /https?:\/\/\S+/.exec(mail?.text ?? '')?.[0]
  check('the email carries a link to the reset page', !!link && new URL(link).pathname === '/reset-password', link ? new URL(link).pathname : 'no link')

  await page.goto(link)
  await page.getByRole('heading', { name: 'Choose a new password' }).waitFor()
  await page.getByLabel('New password').fill('new-password-2')
  await page.getByLabel('Type it again').fill('new-password-2')
  await page.getByRole('button', { name: 'Save new password' }).click()
  await page.getByRole('status').filter({ hasText: 'Your password has been changed' }).waitFor({ timeout: 15000 })
  check('the new password is saved and the page says so', true)

  await page.getByRole('link', { name: 'Log in' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('old-password-1')
  await page.getByRole('button', { name: /^log in$/i }).click()
  await page.getByRole('alert').waitFor({ timeout: 15000 })
  check('the old password no longer works', page.url().endsWith('/login'))
  await page.getByLabel('Password').fill('new-password-2')
  await page.getByRole('button', { name: /^log in$/i }).click()
  await page.waitForURL('**/admin/**', { timeout: 20000 })
  check('the new password signs in to the dashboard', true)

  // The same link, a second time, is refused.
  const reuse = await browser.newPage()
  await reuse.goto(link)
  await reuse.getByLabel('New password').fill('another-password-3')
  await reuse.getByLabel('Type it again').fill('another-password-3')
  await reuse.getByRole('button', { name: 'Save new password' }).click()
  await reuse.getByRole('alert').filter({ hasText: 'invalid or has expired' }).waitFor({ timeout: 15000 })
  check('a used link is refused with the one message for every bad link', true)

  check('no script errors', problems.length === 0, problems[0])
} catch (err) {
  check('browser journey', false, err.message.split('\n')[0])
} finally {
  await browser.close()
}
console.log(failures ? `\n${failures} failed` : '\nAll passed')
process.exit(failures ? 1 : 0)
