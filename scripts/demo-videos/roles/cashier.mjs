// The Cashier's walkthrough: the register, and what a cashier cannot reach. One entry per chapter.
// Every tap, field and key is announced; the register's own tabs and buttons lead from page to page.
import { WEB, DEMO, api, login, showcaseStoreId, signedInState, sidebar } from '../lib.mjs'

/** The cashier's register session, and the owner's token to put things back between takes. */
async function cashier(ctx, browser) {
  if (!ctx.cashier) {
    const { token, storeId } = await showcaseStoreId()
    // A cashier who is not on the team (the Owner video's Team chapter adds them back) cannot sign in to the register.
    const staff = (await api('GET', `/stores/${storeId}/staff`, { token })).json ?? []
    if (!staff.some((m) => m.email === DEMO.cashier)) await api('POST', `/stores/${storeId}/staff`, { token, body: { email: DEMO.cashier, role: 'cashier' } })
    ctx.cashier = { ownerToken: token, storeId, state: await signedInState(browser, DEMO.cashier, { path: '/pos/login', landing: (url) => url.pathname.startsWith('/pos/') && url.pathname !== '/pos/login' }) }
  }
  return ctx.cashier
}
const asCashier = (ctx) => ({ storageState: ctx.cashier.state, onState: (s) => (ctx.cashier.state = s) })

/** Puts the register back to "no shift open", so the opening chapter can open one again. */
async function closeOpenShift(c) {
  const token = await login(DEMO.cashier)
  const shift = (await api('GET', `/stores/${c.storeId}/pos/shift`, { token })).json
  if (shift?.id) await api('POST', `/stores/${c.storeId}/pos/shift/close`, { token, body: { countedCash: shift.expectedCash ?? shift.openingFloat ?? 0 } })
}
/** Makes sure a shift is open, for the chapters that sell (each can be filmed on its own). */
async function ensureOpenShift(c) {
  const token = await login(DEMO.cashier)
  const shift = (await api('GET', `/stores/${c.storeId}/pos/shift`, { token })).json
  if (!shift?.id) await api('POST', `/stores/${c.storeId}/pos/shift/open`, { token, body: { openingFloat: 5000 } })
}

/** Opens the register where the cashier lands after signing in, off camera (the shift is opened in `before`). */
async function atRegister(f) {
  await f.page.goto(WEB + '/pos')
  await f.page.getByPlaceholder('SKU or product name').waitFor({ timeout: 20000 })
  await f.page.waitForTimeout(800)
  f.start()
}
const tile = (page, name) => page.getByRole('button', { name: new RegExp(name) }).first()

export const chapters = [
  {
    slug: 'sign-in',
    title: 'Sign in to the register',
    setup: cashier,
    before: (ctx) => closeOpenShift(ctx.cashier),
    async run(f) {
      const { page } = f
      await page.goto(WEB + '/pos/login')
      await page.getByLabel('Email').waitFor()
      f.start()
      await f.say('Path: the register\'s sign-in page (/pos). The Cashier uses the email and password the owner set up.')
      await f.type(page.getByLabel('Email'), DEMO.cashier, 'the Cashier\'s email')
      await f.type(page.getByLabel('Password'), DEMO.password, 'the password')
      await f.click(page.getByRole('button', { name: /^Sign in/ }), 'Sign in')
      await page.waitForURL('**/pos/**', { timeout: 30000 })
      await page.getByRole('heading', { name: 'Open the register' }).waitFor({ timeout: 20000 })
      await f.result(page.getByRole('heading', { name: 'Open the register' }).locator('xpath=..'), 'signed in as the Cashier: just the register', 3500)
    },
  },
  {
    slug: 'open-shift',
    title: 'Open a shift',
    setup: cashier,
    options: asCashier,
    before: (ctx) => closeOpenShift(ctx.cashier),
    async run(f) {
      const { page } = f
      await page.goto(WEB + '/pos')
      await page.getByRole('heading', { name: 'Open the register' }).waitFor({ timeout: 20000 })
      f.start()
      await f.say('Step 1: Every working day starts by counting the cash in the drawer and typing it in.')
      await f.type(page.getByLabel(/Starting cash/), '5000', 'starting cash in the drawer')
      await f.click(page.getByRole('button', { name: 'Open shift' }), 'Open shift')
      await page.getByPlaceholder('SKU or product name').waitFor({ timeout: 20000 })
      await f.result(page.getByRole('button', { name: 'Close shift' }), 'the shift is open: Rs 5,000 in the drawer', 3500)
    },
  },
  {
    slug: 'cash-sale',
    title: 'A cash sale',
    setup: cashier,
    options: asCashier,
    before: (ctx) => ensureOpenShift(ctx.cashier),
    async run(f, ctx) {
      const { page } = f
      await atRegister(f)
      await f.say('Step 1: A customer brings two items. Tap each product (or scan or type its SKU).')
      await f.click(tile(page, 'Clay Chai Cup'), 'Clay Chai Cup')
      await f.click(tile(page, 'Scented Candle'), 'Scented Candle')
      await f.click(page.getByRole('button', { name: 'Increase Scented Candle' }), '+ (a second candle)')
      await f.result(page.getByRole('region', { name: 'Current sale' }).or(page.getByText('Current sale').locator('xpath=ancestor::*[2]')).first(), 'the sale: prices with each product\'s discount', 3500)
      await f.say('Step 2: Charge, then type the cash the customer handed over.')
      await f.click(page.getByRole('button', { name: /^Charge/ }), 'Charge')
      await page.getByRole('button', { name: /^Complete sale/ }).waitFor()
      await f.type(page.locator('input[id^="tendered-"]').first(), '5000', 'cash received')
      await f.result(page.getByText('Change to give').first().locator('xpath=..'), 'the change to give back', 3000)
      await f.click(page.getByRole('button', { name: /^Complete sale/ }), 'Complete sale')
      await page.getByRole('button', { name: 'New sale' }).waitFor({ timeout: 20000 })
      await f.result(page.getByRole('article').first(), 'the receipt: MRP of discounted items and "You saved"', 5000)
      await f.click(page.getByRole('button', { name: 'New sale' }), 'New sale')
    },
  },
  {
    slug: 'discount',
    title: 'A discount within the limit',
    setup: cashier,
    options: asCashier,
    before: (ctx) => ensureOpenShift(ctx.cashier),
    async run(f, ctx) {
      const { page } = f
      await atRegister(f)
      await f.say('Step 1: A regular customer wants a lawn suit. Search for it.')
      await f.type(page.getByPlaceholder('SKU or product name'), 'lawn', 'product name or SKU')
      await f.click(tile(page, 'Lawn Suit'), 'Lawn Suit 3 Piece')
      await f.say('Step 2: Give a discount. Cashiers have a limit the owner sets: 10% here.')
      await f.click(page.getByRole('button', { name: /^Discount/ }), 'Discount')
      await page.getByRole('button', { name: 'Apply discount' }).waitFor()
      await f.type(page.getByLabel('Percent', { exact: true }), '15', 'percent off: 15')
      await f.click(page.getByRole('button', { name: 'Apply discount' }), 'Apply discount')
      await f.result(page.getByRole('dialog').first(), '15% is refused: more than the cashier\'s limit', 4000)
      await f.type(page.getByLabel('Percent', { exact: true }), '10', 'percent off: 10')
      await f.click(page.getByRole('button', { name: 'Apply discount' }), 'Apply discount')
      await f.say('Step 3: 10% is within the limit. Charge it to a card this time.')
      await f.click(page.getByRole('button', { name: /^Charge/ }), 'Charge')
      await page.getByRole('button', { name: /^Complete sale/ }).waitFor()
      await f.click(page.getByRole('group', { name: 'Payment 1 method' }).getByRole('button', { name: 'Card' }), 'Card')
      await f.click(page.getByRole('button', { name: /^Complete sale/ }), 'Complete sale')
      await page.getByRole('button', { name: 'New sale' }).waitFor({ timeout: 20000 })
      await f.result(page.getByRole('article').first(), 'the receipt shows the discount and what was saved', 4500)
      await f.click(page.getByRole('button', { name: 'New sale' }), 'New sale')
    },
  },
  {
    slug: 'hold-sale',
    title: 'Hold a sale and come back to it',
    setup: cashier,
    options: asCashier,
    before: (ctx) => ensureOpenShift(ctx.cashier),
    async run(f, ctx) {
      const { page } = f
      await atRegister(f)
      await f.say('Step 1: A customer goes to fetch their wallet. Put their sale on hold.')
      await f.click(tile(page, 'Winter Shawl'), 'Winter Shawl')
      await f.click(page.getByRole('button', { name: /^Hold/ }), 'Hold')
      await f.result(page.getByRole('button', { name: /^Held/ }), 'held: the register is free for the next customer', 3000)
      await f.say('Step 2: They are back. Open the held sales and resume it.')
      await f.click(page.getByRole('button', { name: /^Held/ }), 'Held')
      await f.click(page.getByRole('button', { name: 'Resume' }).first(), 'Resume')
      await f.result(page.getByRole('button', { name: /^Charge/ }), 'back in the cart, ready to charge', 3000)
    },
  },
  {
    slug: 'sales-history',
    title: 'Sales history and receipts',
    setup: cashier,
    options: asCashier,
    before: (ctx) => ensureOpenShift(ctx.cashier),
    async run(f, ctx) {
      const { page } = f
      await atRegister(f)
      await f.say('Path: register tabs > Sales. The sales made at this register.')
      await f.click(page.getByRole('link', { name: 'Sales' }), 'Sales')
      await page.getByRole('heading', { name: 'Sales history' }).waitFor()
      await f.result(page.getByRole('table').first(), 'each sale: time, customer, how it was paid, total', 3500)
      await f.say('Step 1: Open one to see its receipt, ready to print again.')
      await f.click(page.getByRole('button', { name: /^Open sale/ }).first(), 'Open (the latest sale)')
      await f.result(page.getByRole('article').first(), 'the receipt', 3500)
    },
  },
  {
    slug: 'close-shift',
    title: 'Close the shift',
    setup: cashier,
    options: asCashier,
    async before(ctx) {
      const c = ctx.cashier
      await ensureOpenShift(c)
      // Filmed on its own? Give the shift a cash sale, so the drawer summary has something in it.
      const token = await login(DEMO.cashier)
      let shift = (await api('GET', `/stores/${c.storeId}/pos/shift`, { token })).json
      if (!shift.totals?.salesCount) {
        const cups = (await api('GET', `/stores/${c.storeId}/products?limit=50`, { token })).json.data.find((p) => p.title === 'Clay Chai Cup (Set of 4)')
        await api('POST', `/stores/${c.storeId}/pos/sales`, { token, body: { items: [{ productId: cups.id, quantity: 1 }], payments: [{ method: 'cash', amount: cups.salePrice }] } })
        shift = (await api('GET', `/stores/${c.storeId}/pos/shift`, { token })).json
      }
      c.shift = shift
    },
    async run(f, ctx) {
      const { page } = f
      const { shift } = ctx.cashier
      await atRegister(f)
      await f.say('Path: header > Close shift. At the end of the day, count the drawer and close.')
      await f.click(page.getByRole('button', { name: 'Close shift' }).first(), 'Close shift')
      const counted = page.getByLabel(/Cash counted/)
      await counted.waitFor({ timeout: 15000 })
      await f.result(page.getByText(/The expected amount is shown after you close/), 'a blind count: the expected cash is shown only after closing', 4000)
      await f.say('Step 1: Count the cash in the drawer and type the total.')
      await f.type(counted, String(shift.expectedCash ?? shift.totals?.expectedCash), 'cash counted')
      await f.click(page.getByRole('button', { name: 'Close shift' }).last(), 'Close shift')
      const ok = page.getByText('The drawer balances exactly.')
      await ok.waitFor({ timeout: 15000 })
      await f.result(page.getByText('Expected in drawer').locator('xpath=..'), 'starting cash, cash sales, expected and counted', 4500)
      await f.result(ok, 'the count matches: the drawer balances', 4000)
      await f.say('A drawer that is short or over shows here, and in the Manager\'s daily summary.')
    },
  },
  {
    slug: 'not-allowed',
    title: 'What a cashier cannot do',
    setup: async (ctx, browser) => {
      await cashier(ctx, browser)
      ctx.cashier.admin = await signedInState(browser, DEMO.cashier)
    },
    options: (ctx) => ({ storageState: ctx.cashier.admin, onState: (s) => (ctx.cashier.admin = s) }),
    async run(f) {
      const { page } = f
      await page.goto(WEB + '/admin/products')
      await page.getByRole('heading', { name: 'Products', level: 1 }).waitFor()
      await page.waitForTimeout(1200)
      f.start()
      await f.say('If the Cashier signs in to the shop\'s admin instead, this is where they land.')
      await f.result(page.getByText(/You can see this store's products/).first(), 'products: view only, no editing, no AI tools', 4500)
      await f.say('Path: Sidebar > Orders.')
      await f.click(sidebar(page, 'Orders'), 'Orders in the sidebar')
      await f.result(page.getByRole('alert').first(), 'refused: it needs the Orders permission', 4000)
      await f.say('Path: Sidebar > Voice notes.')
      await f.click(sidebar(page, 'Voice notes'), 'Voice notes in the sidebar')
      await f.result(page.getByRole('alert').first(), 'refused: it needs the Products permission', 4000)
      await f.say('The server checks every request, so hiding a button is never the only protection.', 4500)
    },
  },
]
