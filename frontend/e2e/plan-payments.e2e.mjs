// Pro plan payments by transfer in a real browser (2026-11): an owner pays, an approver reviews.
//
//   1. A PKR owner opens Upgrade to Pro, gets a reference code, sends a screenshot and transaction ID.
//   2. The approver gets the email (the e2e server's outbox), opens the link signed out, signs in, lands
//      back on the review page, and approves. The owner then sees Pro.
//   3. A USD owner, approved from the approval queue instead of the email.
//   4. A rejected payment: the owner sees the reason.
//   5. A transaction ID used before is refused.
//   6. With the AI unavailable the request still reaches the queue, marked "Needs manual review".
//   7. On a phone the upgrade page fits the screen.
//
// Setup: the e2e server (backend/scripts/e2e-server.ts) and `npm run dev` in the frontend, then:
//   node e2e/plan-payments.e2e.mjs        (WEB and API_ROOT point it at other ports)
// Afterwards run backend/scripts/cleanup-test-data.ts (emails and slugs use the e2e- prefix).
import { chromium } from 'playwright'

const WEB = process.env.WEB ?? 'http://localhost:5173'
const ROOT = process.env.API_ROOT ?? 'http://localhost:5000'
const API = `${ROOT}/api/v1`
const suffix = Date.now().toString(36)
const password = 'password123'
const APPROVERS = ['e2e-approver-1@example.com', 'e2e-approver-2@example.com']
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeklEQVR4nO3PUQkAIBTAwJfBmKYzoiH8OITBAtzm7PV1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWPHYBk4TBDzDRWcMAAAAASUVORK5CYII=', 'base64')
let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}
/** Waits for it to appear (pages load their data after navigating), instead of looking only once. */
const visible = (locator) => locator.first().waitFor({ timeout: 15000 }).then(() => true, () => false)
async function api(method, p, { token, body } = {}) {
  const res = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text()
  return { status: res.status, json: t ? JSON.parse(t) : null }
}
const e2e = (path, body) => fetch(`${ROOT}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const lastEmail = async (to) => {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${ROOT}/__e2e/last-email?to=${encodeURIComponent(to)}`)
    if (res.ok) return res.json()
    await new Promise((r) => setTimeout(r, 150))
  }
  return null
}
const today = () => new Date().toISOString().slice(0, 10)
const reading = (over) => ({ readable: true, amount: 3000, currency: 'PKR', date: today(), receiverName: 'Zyro Demo', receiverAccount: '****0001', reference: null, transactionId: null, editingSigns: [], confidence: 0.97, ...over })

async function owner(tag, currency) {
  const email = `e2e-plan-${tag}-${suffix}@example.com`
  const reg = await api('POST', '/auth/register', { body: { email, password, storeName: `E2E Plan ${tag}`, storeSlug: `e2e-plan-${tag}-${suffix}`, currency } })
  if (reg.status !== 201) throw new Error(`register ${tag}: ${reg.status}`)
  return { email, token: reg.json.accessToken, storeId: (await api('GET', '/users/me/stores', { token: reg.json.accessToken })).json[0].id }
}
// The approvers are fixed addresses (the e2e server's PLAN_APPROVER_EMAILS): made once, then reused.
for (const [i, email] of APPROVERS.entries()) {
  const reg = await api('POST', '/auth/register', { body: { email, password, storeName: `E2E Approver ${i + 1}`, storeSlug: `e2e-approver-${i + 1}-${suffix}` } })
  if (reg.status !== 201 && reg.status !== 409) throw new Error(`approver ${i + 1}: ${reg.status}`)
  await e2e('/__e2e/make-admin', { email })
}

const browser = await chromium.launch()
const problems = []
async function page(viewport = { width: 1280, height: 900 }) {
  const p = await (await browser.newContext({ viewport })).newPage()
  p.on('pageerror', (e) => problems.push(e.message))
  return p
}
async function signIn(p, email, landing = /\/admin/) {
  await p.getByLabel('Email').fill(email)
  await p.getByLabel('Password').fill(password)
  await p.getByRole('button', { name: /log in|sign in/i }).click()
  await p.waitForURL(landing)
}
async function payInBrowser(o, transactionId, reply) {
  await e2e('/__e2e/plan-proof-reply', { reply })
  const p = await page()
  await p.goto(`${WEB}/login`)
  await signIn(p, o.email)
  await p.goto(`${WEB}/admin/upgrade`)
  await p.getByRole('button', { name: 'Get my reference code' }).click()
  const reference = await p.getByLabel('Reference code', { exact: true }).innerText()
  await p.getByLabel('Payment screenshot').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: png })
  await p.getByLabel('Transaction ID (from your receipt)').fill(transactionId)
  await p.getByRole('button', { name: 'Send for review' }).click()
  return { p, reference }
}
const reviewLink = async (to) => /Review request: (\S+)/.exec((await lastEmail(to))?.text ?? '')?.[1]

try {
  // ---- 1 and 2: PKR owner, approved from the emailed link ----
  const pkr = await owner('pkr', 'PKR')
  {
    const p = await page()
    await p.goto(`${WEB}/login`)
    await signIn(p, pkr.email)
    await p.goto(`${WEB}/admin/upgrade`)
    const price = await p.getByLabel('Price', { exact: true }).innerText()
    check('the upgrade page shows the price in rupees, with the currency code', /Rs\s?3,000/.test(price) && price.includes('(PKR)'), price)
    check('it shows the payment details for PKR', await visible(p.getByText('PK00TEST0001')))
    check('it says a person reviews the payment, in 24 to 48 hours, with a refund if rejected', await visible(p.getByText(/reviewed by a person.*24 to 48 hours.*refund/)))
    await p.context().close()
  }
  const { p: ownerPage, reference } = await payInBrowser(pkr, `PKR-TRX-${suffix}`, reading({ transactionId: `PKR-TRX-${suffix}` }))
  check('after sending, the owner is told the payment is being reviewed', await visible(ownerPage.getByText('Your payment is being reviewed.')), reference)

  const mail = await lastEmail(APPROVERS[0])
  const link = await reviewLink(APPROVERS[0])
  check('the approver gets an email with the amount, the reference and a review link', !!link && mail.text.includes(reference) && /\(PKR\)/.test(mail.text))
  const ap = await page()
  await ap.goto(link)
  await ap.waitForURL('**/login')
  check('opening the link signed out asks the approver to sign in first', true)
  await signIn(ap, APPROVERS[0], /plan-requests\/review/)
  check('after signing in, the approver lands back on the review page', await visible(ap.getByRole('heading', { name: 'E2E Plan pkr' })))
  check('the automatic checks are shown, and all passed', await visible(ap.getByText('All checks passed')))
  check('the proof screenshot is shown', await visible(ap.getByRole('img', { name: `Payment proof for ${reference}` })))
  await ap.getByRole('button', { name: /^Approve:/ }).click()
  check('the approver approves', await visible(ap.getByText('Done: approved.')))

  await ownerPage.reload()
  check('the owner now sees Pro, active', await visible(ownerPage.getByRole('heading', { name: 'Pro plan' })))
  check('and the payment in their history as approved', await visible(ownerPage.getByRole('region', { name: 'Past payments' }).getByText('Approved')))
  check('the owner gets an emailed receipt', /Pro until/.test((await lastEmail(pkr.email))?.text ?? ''))
  await ownerPage.context().close()

  // A second approver opening the same request sees it already decided.
  const ap2 = await page()
  await ap2.goto(await reviewLink(APPROVERS[1]))
  await signIn(ap2, APPROVERS[1], /plan-requests\/review/)
  check('the other approver is told it was already decided', await visible(ap2.getByText(/already been (used|decided)/)))
  check('and has no decision buttons', (await ap2.getByRole('button', { name: /^Approve:/ }).count()) === 0)

  // ---- 3: USD owner, approved from the queue ----
  const usd = await owner('usd', 'AED')
  const { p: usdPage } = await payInBrowser(usd, `USD-TRX-${suffix}`, reading({ amount: 12, currency: 'USD', receiverAccount: 'WISE-0001', transactionId: `USD-TRX-${suffix}` }))
  await visible(usdPage.getByText('Your payment is being reviewed.'))
  await ap2.goto(`${WEB}/admin/platform/plan-requests`)
  const row = ap2.getByRole('listitem').filter({ hasText: 'E2E Plan usd' })
  await visible(row)
  check('a USD owner pays in dollars, shown with the code', /\$12(\.00)? \(USD\)/.test(await row.innerText()), (await row.innerText()).replace(/\n/g, ' '))
  await row.getByRole('link', { name: 'Open' }).click()
  await ap2.getByRole('button', { name: /^Approve:/ }).click()
  await visible(ap2.getByText('Done: approved.'))
  await usdPage.reload()
  check('the USD owner sees Pro after approval from the queue', await visible(usdPage.getByRole('heading', { name: 'Pro plan' })))
  await usdPage.context().close()

  // ---- 4: rejected ----
  const rej = await owner('rej', 'PKR')
  const { p: rejPage } = await payInBrowser(rej, `REJ-TRX-${suffix}`, reading({ amount: 2000 }))
  await visible(rejPage.getByText('Your payment is being reviewed.'))
  await ap2.goto(`${WEB}/admin/platform/plan-requests`)
  const rejRow = ap2.getByRole('listitem').filter({ hasText: 'E2E Plan rej' })
  check('a wrong amount is flagged for a close look', await visible(rejRow.getByText('Needs a close look')))
  await rejRow.getByRole('link', { name: 'Open' }).click()
  await ap2.getByLabel(/Reason, if you reject/).fill('Only Rs 2,000 arrived')
  await ap2.getByRole('button', { name: 'Reject' }).click()
  await visible(ap2.getByText('Done: rejected.'))
  await rejPage.reload()
  check('the owner sees the payment rejected, with the reason', await visible(rejPage.getByText('Reason: Only Rs 2,000 arrived')))
  check('and stays on Free', (await rejPage.getByRole('heading', { name: 'Pro plan' }).count()) === 0)
  check('the owner is emailed refund instructions', /returned|refund/i.test((await lastEmail(rej.email))?.text ?? ''))

  // ---- 5: a transaction ID used before ----
  await rejPage.getByRole('button', { name: 'Get my reference code' }).click()
  await rejPage.getByLabel('Payment screenshot').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: png })
  await rejPage.getByLabel('Transaction ID (from your receipt)').fill(`PKR-TRX-${suffix}`)
  await rejPage.getByRole('button', { name: 'Send for review' }).click()
  check('a transaction ID used before is refused', await visible(rejPage.getByText('This transaction ID has already been used.')))
  await rejPage.context().close()

  // ---- 6: the AI unavailable ----
  const down = await owner('down', 'PKR')
  const { p: downPage } = await payInBrowser(down, `DOWN-TRX-${suffix}`, 'fail')
  check('with the AI unavailable the owner can still send the payment', await visible(downPage.getByText('Your payment is being reviewed.')))
  await ap2.goto(`${WEB}/admin/platform/plan-requests`)
  check('it reaches the queue marked "Needs manual review"', await visible(ap2.getByRole('listitem').filter({ hasText: 'E2E Plan down' }).getByText('Needs manual review')))
  await downPage.context().close()

  // ---- 7: phone ----
  const phone = await page({ width: 390, height: 844 })
  await phone.goto(`${WEB}/login`)
  await signIn(phone, down.email)
  await phone.goto(`${WEB}/admin/upgrade`)
  await visible(phone.getByText('Your payment is being reviewed.'))
  check('on a phone the upgrade page fits the screen', await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await phone.context().close()
  await ap.context().close()
  await ap2.context().close()
} catch (err) {
  failures += 1
  console.log('FAIL  the journey stopped:', String(err.message).split('\n')[0])
} finally {
  await e2e('/__e2e/plan-proof-reply', { reply: 'fail' })
  await browser.close()
}
check('no script errors in the browser', problems.length === 0, problems[0])
console.log(failures === 0 ? '\nAll plan payment checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
