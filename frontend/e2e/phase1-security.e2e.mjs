// Browser test for the password protections: what a real person sees when they guess wrong
// too many times. Needs the API started with rate limiting ON and a private counter prefix:
//   backend:   $env:RATE_LIMIT_ENABLED="true"; $env:RATE_LIMIT_PREFIX="rl-e2e-$(Get-Date -f mmss):"; npx tsx scripts/e2e-server.ts
//   frontend:  npm run dev
//   frontend:  node e2e/phase1-security.e2e.mjs
import { chromium } from 'playwright'

const WEB = 'http://localhost:5173'
const API = 'http://localhost:5000/api/v1'
let failures = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
  if (!ok) failures++
}

const suffix = Date.now().toString(36)
const email = `p1sec-${suffix}@example.com`
const reg = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'correct-horse-1', storeName: 'Sec Shop', storeSlug: `aurora-sec-${suffix}` }),
})
check('setup: test account created', reg.status === 201, `status=${reg.status} (is the API running with rate limiting ON?)`)

const browser = await chromium.launch()
const page = await (await browser.newContext({ locale: 'en-US' })).newPage()
await page.goto(`${WEB}/login`)
await page.getByRole('heading', { name: 'Log in' }).waitFor()

const tryLogin = async (password) => {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByRole('alert').waitFor()
  return (await page.getByRole('alert').textContent()) ?? ''
}

let last = ''
for (let i = 1; i <= 5; i++) last = await tryLogin(`wrong-${i}`)
check('login: the first five wrong passwords each say "Invalid credentials"', last.includes('Invalid credentials'), last)

const blocked = await tryLogin('wrong-6')
check('login: the sixth attempt shows a clear "too many attempts, wait N minutes" message', /Too many attempts/.test(blocked) && /minute/.test(blocked), blocked)
await page.screenshot({ path: new URL('./shots/p1-locked.png', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1') }).catch(() => undefined)

const correct = await tryLogin('correct-horse-1')
check('login: the correct password is also refused while locked (guessing cannot succeed)', /Too many attempts/.test(correct) && page.url().endsWith('/login'))

await page.goto(`${WEB}/register`)
await page.getByRole('heading', { name: 'Create your store' }).waitFor()
const pw = page.getByLabel('Password')
check('register: the password field stops at 72 characters (the limit bcrypt can honour)', (await pw.getAttribute('maxlength')) === '72')

await browser.close()
console.log(failures === 0 ? '\nAll browser checks passed.' : `\n${failures} browser check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
