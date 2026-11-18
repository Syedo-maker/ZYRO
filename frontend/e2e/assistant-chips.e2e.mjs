// The shopping assistant's suggestion chips in a real browser (B4, 2026-11): four suggested questions
// before the first message; tapping one (here from the keyboard) sends it as an ordinary message, the
// same request with the same body as a typed one, and it counts against the store's chat allowance
// exactly like one; the chips then leave; they wrap on a 390-pixel phone; and when the AI is down, or
// the shopper is too fast, the widget says so in one plain sentence.
//
// Setup: Redis, `npx tsx scripts/e2e-server.ts` in backend (its fake AI answers the chat), and
// `npm run dev` in frontend, then:  node e2e/assistant-chips.e2e.mjs
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

const reg = await api('POST', '/auth/register', { body: { email: `e2e-chips-${suffix}@example.com`, password: 'password123', storeName: `E2E Chips ${suffix}`, storeSlug: `e2e-chips-${suffix}` } })
const token = reg.json.accessToken
const storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
await api('POST', `/stores/${storeId}/products`, { token, body: { title: 'Ceramic Mug', price: 12.5, stock: 10, category: 'kitchen' } })
const chatUsed = async () => (await api('GET', `/stores/${storeId}/ai-usage`, { token })).json.chatMessagesUsed

const browser = await chromium.launch()
async function openWidget(viewport = { width: 1280, height: 900 }) {
  const page = await (await browser.newContext({ viewport })).newPage()
  await page.goto(`${WEB}/store/${storeId}`)
  await page.getByRole('button', { name: 'Open shopping assistant' }).click()
  const chat = page.getByRole('dialog', { name: 'Shopping assistant' })
  await chat.waitFor({ timeout: 15000 })
  return { page, chat, chips: chat.getByRole('group', { name: 'Suggested questions' }) }
}
const isChat = (req) => req.method() === 'POST' && req.url().endsWith(`/stores/${storeId}/assistant/chat`)

try {
  // ---- A chip, from the keyboard
  const { page, chat, chips } = await openWidget()
  const problems = []
  page.on('pageerror', (e) => problems.push(e.message))
  const buttons = chips.getByRole('button')
  check('four suggested questions are offered before the first message', (await buttons.count()) === 4, (await buttons.allInnerTexts()).join(' | '))
  check('one of them is a budget in the shop\'s currency', (await buttons.allInnerTexts()).includes('Something under 50 USD'))

  const before = await chatUsed()
  const sent = []
  page.on('request', (req) => isChat(req) && sent.push(req.postDataJSON()))
  await buttons.first().focus()
  const label = await buttons.first().innerText()
  await page.keyboard.press('Enter')
  await chat.getByText(label, { exact: true }).waitFor({ timeout: 15000 })
  check('pressing Enter on a chip sends its words as the shopper\'s message', true)
  await chat.getByRole('status').filter({ hasText: 'Thinking' }).waitFor({ state: 'detached', timeout: 30000 })
  check('and the assistant answers it', (await chat.locator('p').count()) >= 3)
  check('the chips leave once a message is sent', (await chips.count()) === 0)
  check('the chip made exactly one chat request, with the same body as a typed message', sent.length === 1 && Object.keys(sent[0]).sort().join() === 'conversationId,message' && sent[0].message === label, JSON.stringify(sent))
  const afterChip = await chatUsed()
  check('it counted against the chat allowance', afterChip === before + 1, `${before} to ${afterChip}`)

  await chat.getByLabel('Your message').fill('Do you have mugs?')
  await chat.getByRole('button', { name: 'Send' }).click()
  await chat.getByRole('status').filter({ hasText: 'Thinking' }).waitFor({ state: 'detached', timeout: 30000 })
  const afterTyped = await chatUsed()
  check('exactly as much as a typed message', afterTyped - afterChip === afterChip - before, `chip ${afterChip - before}, typed ${afterTyped - afterChip}`)
  check('the typed message used the same request', sent.length === 2 && Object.keys(sent[1]).sort().join() === 'conversationId,message')
  check('no script errors', problems.length === 0, problems[0])

  // ---- The AI is down: one plain sentence, nothing from the provider
  const down = await openWidget()
  await down.page.route(`**/stores/${storeId}/assistant/chat`, (route) =>
    route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify({ type: 'https://zyro.dev/errors/service-unavailable', title: 'Service unavailable', status: 503, detail: 'The AI assistant is temporarily unavailable. Nothing was used from your AI allowance; please try again later.' }) }),
  )
  await down.chips.getByRole('button').nth(1).click()
  const sorry = down.chat.getByRole('alert')
  await sorry.waitFor({ timeout: 15000 })
  const text = await sorry.innerText()
  check('when the AI is down, a chip shows the friendly unavailable message', text.startsWith('The AI assistant is temporarily unavailable.'), text)
  check('with no status words or provider detail in it', !/(503|Service unavailable|allowance|anthropic|openai|api key)/i.test(text))

  // ---- Too fast
  const fast = await openWidget()
  await fast.page.route(`**/stores/${storeId}/assistant/chat`, (route) => route.fulfill({ status: 429, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Too many requests', status: 429 }) }))
  await fast.chips.getByRole('button').nth(2).click()
  await fast.chat.getByRole('alert').filter({ hasText: 'a little fast' }).waitFor({ timeout: 15000 })
  check('a rate-limited chip says to wait, like a typed message', true)

  // ---- A phone
  const phone = await openWidget({ width: 390, height: 844 })
  const rows = new Set()
  for (const b of await phone.chips.getByRole('button').all()) rows.add(Math.round((await b.boundingBox()).y))
  check('on a 390-pixel phone the chips wrap onto more than one line', rows.size > 1, `${rows.size} lines`)
  const box = await phone.chat.boundingBox()
  check('and the chat fits the screen', box.x >= 0 && box.x + box.width <= 390, `${Math.round(box.x)} to ${Math.round(box.x + box.width)}`)
  check('the page does not scroll sideways', await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
} catch (err) {
  check('browser journey', false, err.message.split('\n')[0])
} finally {
  await browser.close()
}
console.log(failures ? `\n${failures} failed` : '\nAll passed')
process.exit(failures ? 1 : 0)
