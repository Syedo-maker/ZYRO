// The Cashier's walkthrough: the register, and what a cashier cannot reach. One entry per chapter.
import { WEB, DEMO, api, login, showcaseStoreId, signedInState } from '../lib.mjs'

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

export const chapters = [
  {
    slug: 'sign-in',
    title: 'Sign in to the register',
    setup: cashier,
    async run(f, ctx) {
      const { page } = f
      await closeOpenShift(ctx.cashier)
      await page.goto(WEB + '/pos/login')
      await page.getByLabel('Email').waitFor()
      f.start()
      await f.say('A cashier signs in at the register with the email and password the owner gave them.')
      await f.type(page.getByLabel('Email'), DEMO.cashier)
      await f.type(page.getByLabel('Password'), DEMO.password)
      await f.click(page.getByRole('button', { name: /^Sign in/ }))
      await page.waitForURL('**/pos/**', { timeout: 30000 })
      await page.getByRole('heading', { name: 'Open the register' }).waitFor({ timeout: 20000 })
      await f.say('The register opens straight away. No admin pages, no settings: just selling.')
    },
  },
  {
    slug: 'open-shift',
    title: 'Open a shift',
    setup: cashier,
    options: asCashier,
    async run(f, ctx) {
      const { page } = f
      await closeOpenShift(ctx.cashier)
      await page.goto(WEB + '/pos')
      await page.getByRole('heading', { name: 'Open the register' }).waitFor({ timeout: 20000 })
      f.start()
      await f.say('Every working day starts by counting the cash in the drawer.')
      await f.type(page.getByLabel(/Starting cash/), '5000')
      await f.click(page.getByRole('button', { name: 'Open shift' }))
      await page.getByPlaceholder('SKU or product name').waitFor({ timeout: 20000 })
      await f.say('The shift is open with Rs 5,000 in the drawer. Every sale is counted against it.')
    },
  },
  {
    slug: 'cash-sale',
    title: 'A cash sale',
    setup: cashier,
    options: asCashier,
    async run(f, ctx) {
      const { page } = f
      await ensureOpenShift(ctx.cashier)
      await page.goto(WEB + '/pos')
      const search = page.getByPlaceholder('SKU or product name')
      await search.waitFor({ timeout: 20000 })
      f.start()
      await f.say('A customer brings two items. The cashier taps them, or scans or types their SKU.')
      await f.click(page.getByRole('button', { name: /Clay Chai Cup/ }).first())
      await f.click(page.getByRole('button', { name: /Scented Candle/ }).first())
      await f.click(page.getByRole('button', { name: 'Increase Scented Candle' }))
      await f.say('Two candles and a set of cups. Prices come from the shop, with each product\'s own discount already applied.', 4500)
      await f.click(page.getByRole('button', { name: /^Charge/ }))
      await page.getByRole('button', { name: /^Complete sale/ }).waitFor()
      await f.say('Paid in cash: the cashier types what the customer handed over.')
      await f.type(page.locator('input[id^="tendered-"]').first(), '5000')
      await f.say('The change to give back is worked out for them.')
      await f.click(page.getByRole('button', { name: /^Complete sale/ }))
      await page.getByRole('button', { name: 'New sale' }).waitFor({ timeout: 20000 })
      await f.say('Done. The receipt shows the MRP of each discounted item and what the customer saved.', 5000)
      await f.click(page.getByRole('button', { name: 'New sale' }))
    },
  },
  {
    slug: 'discount',
    title: 'A discount within the limit',
    setup: cashier,
    options: asCashier,
    async run(f, ctx) {
      const { page } = f
      await ensureOpenShift(ctx.cashier)
      await page.goto(WEB + '/pos')
      await page.getByPlaceholder('SKU or product name').waitFor({ timeout: 20000 })
      f.start()
      await f.say('A regular customer asks for a discount on a lawn suit.')
      await f.type(page.getByPlaceholder('SKU or product name'), 'lawn')
      await f.click(page.getByRole('button', { name: /Lawn Suit/ }).first())
      await f.click(page.getByRole('button', { name: /^Discount/ }))
      await page.getByRole('button', { name: 'Apply discount' }).waitFor()
      await page.getByText('Percent off').first().click().catch(() => {})
      await f.type(page.getByLabel('Percent', { exact: true }), '15')
      await f.click(page.getByRole('button', { name: 'Apply discount' }))
      await page.waitForTimeout(1500)
      await f.say('15% is refused: the owner lets cashiers give at most 10%. A manager or the owner can give more.', 5000)
      const field = page.getByLabel('Percent', { exact: true })
      if (await field.isVisible().catch(() => false)) {
        await f.type(field, '10')
        await f.click(page.getByRole('button', { name: 'Apply discount' }))
      }
      await page.waitForTimeout(1500)
      await f.say('10% is within the limit and is applied to the sale.')
      await f.click(page.getByRole('button', { name: /^Charge/ }))
      await page.getByRole('button', { name: /^Complete sale/ }).waitFor()
      await page.getByRole('group', { name: 'Payment 1 method' }).getByRole('button', { name: 'Card' }).click().catch(() => {})
      await f.say('Paid by card this time.')
      await f.click(page.getByRole('button', { name: /^Complete sale/ }))
      await page.getByRole('button', { name: 'New sale' }).waitFor({ timeout: 20000 })
      await f.say('Recorded: the receipt shows the discount, and what the customer saved on the MRP.')
      await f.click(page.getByRole('button', { name: 'New sale' }))
    },
  },
  {
    slug: 'hold-sale',
    title: 'Hold a sale and come back to it',
    setup: cashier,
    options: asCashier,
    async run(f, ctx) {
      const { page } = f
      await ensureOpenShift(ctx.cashier)
      await page.goto(WEB + '/pos')
      await page.getByPlaceholder('SKU or product name').waitFor({ timeout: 20000 })
      f.start()
      await f.say('A customer goes to fetch their wallet. The sale can be put on hold while the next customer is served.', 4500)
      await f.click(page.getByRole('button', { name: /Winter Shawl/ }).first())
      await f.click(page.getByRole('button', { name: /^Hold/ }))
      await page.waitForTimeout(1500)
      await f.say('Held. The register is free for the next customer.')
      await f.click(page.getByRole('button', { name: /^Held/ }))
      await page.waitForTimeout(1200)
      await f.say('When the first customer is back, the held sale is picked up again with everything in it.')
      await f.click(page.getByRole('button', { name: 'Resume' }).first())
      await page.waitForTimeout(1500)
      await f.say('Back in the cart, ready to charge.')
    },
  },
  {
    slug: 'sales-history',
    title: 'Sales history and receipts',
    setup: cashier,
    options: asCashier,
    async run(f, ctx) {
      const { page } = f
      await ensureOpenShift(ctx.cashier)
      await page.goto(WEB + '/pos')
      await page.getByPlaceholder('SKU or product name').waitFor({ timeout: 20000 })
      f.start()
      await f.say('The cashier can look back at the sales made at this register.')
      await f.click(page.getByRole('link', { name: 'Sales' }))
      await page.getByRole('heading', { name: 'Sales history' }).waitFor()
      await page.waitForTimeout(1000)
      await f.say('Every sale with its time, customer, how it was paid and its total.')
      await f.click(page.getByRole('button', { name: /^Open sale/ }).first())
      await page.waitForTimeout(1500)
      await f.say('Opening one shows its receipt, ready to print again for the customer.')
    },
  },
  {
    slug: 'close-shift',
    title: 'Close the shift',
    setup: cashier,
    options: asCashier,
    async run(f, ctx) {
      const { page } = f
      await ensureOpenShift(ctx.cashier)
      // Filmed on its own? Give the shift a cash sale, so the drawer summary has something in it.
      const token = await login(DEMO.cashier)
      const c = ctx.cashier
      let shift = (await api('GET', `/stores/${c.storeId}/pos/shift`, { token })).json
      if (!shift.totals?.salesCount) {
        const cups = (await api('GET', `/stores/${c.storeId}/products?limit=50`, { token })).json.data.find((p) => p.title === 'Clay Chai Cup (Set of 4)')
        await api('POST', `/stores/${c.storeId}/pos/sales`, { token, body: { items: [{ productId: cups.id, quantity: 1 }], payments: [{ method: 'cash', amount: cups.salePrice }] } })
        shift = (await api('GET', `/stores/${c.storeId}/pos/shift`, { token })).json
      }
      await page.goto(WEB + '/pos')
      await page.getByPlaceholder('SKU or product name').waitFor({ timeout: 20000 })
      f.start()
      await f.say('At the end of the day the cashier closes the shift and counts the drawer.')
      await f.click(page.getByRole('button', { name: 'Close shift' }).first())
      const counted = page.getByLabel(/Cash counted/)
      await counted.waitFor({ timeout: 15000 })
      await f.say('The register shows the starting cash, the cash sales, and what should be in the drawer.', 4500)
      await f.type(counted, String(shift.expectedCash ?? shift.totals?.expectedCash))
      await f.click(page.getByRole('button', { name: 'Close shift' }).last())
      await page.getByText('The drawer balances exactly.').waitFor({ timeout: 15000 })
      await f.say('The count matches: the drawer balances. A difference would be shown here, and to the owner.', 4500)
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
      await f.say('If the cashier opens the shop\'s admin, they can see the products but not change them.', 4500)
      await f.say('There is no Add product button, no editing, and none of the AI writing tools.', 4500)
      await page.goto(WEB + '/admin/orders')
      await page.getByRole('heading', { name: 'Orders' }).waitFor()
      await page.waitForTimeout(1500)
      await f.say('Orders, payments, analytics and settings refuse them too, and say which permission is missing.', 5000)
      await page.goto(WEB + '/admin/voice-notes')
      await page.waitForTimeout(2000)
      await f.say('The server checks every request, so hiding a button is never the only protection.', 4500)
    },
  },
]
