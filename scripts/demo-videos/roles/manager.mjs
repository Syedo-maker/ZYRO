// The Manager's walkthrough: everything a Manager runs, then what stays with the owner. One entry per chapter.
import { WEB, DEMO, api, login, showcaseStoreId, signedInState } from '../lib.mjs'

/** The manager's session, and the owner's token to put things back between takes. */
async function manager(ctx, browser) {
  if (!ctx.manager) {
    const { token, storeId } = await showcaseStoreId()
    ctx.manager = { ownerToken: token, storeId, state: await signedInState(browser, DEMO.manager) }
  }
  return ctx.manager
}
const asManager = (ctx) => ({ storageState: ctx.manager.state, onState: (s) => (ctx.manager.state = s) })
const productNamed = async (m, title) => (await api('GET', `/stores/${m.storeId}/products?limit=50`, { token: m.ownerToken })).json.data.find((p) => p.title === title)

export const chapters = [
  {
    slug: 'sign-in',
    title: 'Sign in as a Manager',
    setup: manager,
    async run(f) {
      const { page } = f
      await page.goto(WEB + '/login')
      await page.getByLabel('Email').waitFor()
      f.start()
      await f.say('A Manager signs in to the same admin as the owner, with their own account.')
      await f.type(page.getByLabel('Email'), DEMO.manager)
      await f.type(page.getByLabel('Password'), DEMO.password)
      await f.click(page.getByRole('button', { name: /log in|sign in/i }))
      await page.waitForURL('**/admin/**', { timeout: 30000 })
      await page.getByRole('heading', { name: 'Products', level: 1 }).waitFor()
      await f.say('The role decides what they see: the menu has no Plan & billing and no Settings for a Manager.', 4500)
    },
  },
  {
    slug: 'dashboard',
    title: 'Sales figures',
    setup: manager,
    options: asManager,
    async run(f) {
      const { page } = f
      await page.goto(WEB + '/admin/dashboard')
      await page.getByRole('heading', { name: 'Dashboard' }).waitFor()
      await page.waitForTimeout(2000)
      f.start()
      await f.say('Managers see the shop\'s figures: net sales, orders, average order and refunds.')
      await f.click(page.getByRole('group', { name: 'Period', exact: true }).getByRole('button', { name: '7 days' }))
      await page.waitForTimeout(1500)
      await f.say('This week, online and at the counter, day by day.')
      await f.scrollBy(600)
      await f.say('Top products, where sales come from, and the latest orders.')
    },
  },
  {
    slug: 'products',
    title: 'Products, prices and stock',
    setup: manager,
    options: asManager,
    async run(f, ctx) {
      const { page } = f
      const m = ctx.manager
      const candle = await productNamed(m, 'Scented Candle')
      await api('PUT', `/stores/${m.storeId}/products/${candle.id}`, { token: m.ownerToken, body: { title: candle.title, description: candle.description, actualPrice: 900, discountType: 'percent', discountValue: 15, stock: 60, categoryId: candle.categoryId, images: candle.images, tags: candle.tags } })
      await page.goto(WEB + '/admin/products')
      await page.getByRole('heading', { name: 'Products', level: 1 }).waitFor()
      f.start()
      await f.say('Managers run the catalogue. Candles are moving slowly, so the discount goes up to 20%.')
      await f.click(page.getByRole('button', { name: 'Edit Scented Candle' }))
      await f.type(page.getByLabel('Discount (optional)'), '20')
      await page.waitForTimeout(800)
      await f.say('The selling price follows: Rs 720 instead of Rs 900.')
      await page.getByText('AI tools', { exact: true }).first().scrollIntoViewIfNeeded()
      await page.waitForTimeout(800)
      await f.say('The same AI writing tools as the owner are here, and use the store\'s AI allowance.', 4500)
      await f.click(page.getByRole('button', { name: 'Save', exact: true }))
      const row = page.getByRole('row').filter({ hasText: 'Scented Candle' })
      await row.filter({ hasText: '20% off' }).waitFor({ timeout: 20000 })
      await f.scrollTo(row)
      await f.say('Saved, and the shop shows "20% off" straight away.')
    },
  },
  {
    slug: 'orders',
    title: 'Pack and ship orders',
    setup: manager,
    options: asManager,
    async run(f) {
      const { page } = f
      await page.goto(WEB + '/admin/orders')
      await page.getByRole('heading', { name: 'Orders' }).waitFor()
      f.start()
      await f.say('Managers handle the orders. One paid order is still waiting to be shipped.')
      await f.click(page.getByRole('tab', { name: /^Processing/ }))
      await page.waitForTimeout(1200)
      await f.click(page.getByRole('row').filter({ hasText: 'Processing' }).first().getByRole('button').first())
      const carrier = page.getByLabel('Carrier')
      await carrier.waitFor({ timeout: 15000 })
      await f.type(carrier, 'Leopards')
      await f.type(page.getByLabel('Tracking number'), 'LCS-DEMO-55017')
      await f.click(page.getByRole('button', { name: 'Mark shipped' }))
      await page.waitForTimeout(1500)
      await f.say('Shipped with the courier and tracking number. Refunds are a Manager\'s job too.', 4500)
    },
  },
  {
    slug: 'payments',
    title: 'Cash on delivery',
    setup: manager,
    options: asManager,
    async run(f, ctx) {
      const { page } = f
      const m = ctx.manager
      // Make sure a cash on delivery order is waiting, placed the way a shopper places one.
      const waiting = (await api('GET', `/stores/${m.storeId}/payments/cod/pending`, { token: m.ownerToken })).json ?? []
      if (!waiting.length) {
        const guest = `video-guest-cod-${Date.now()}`
        const kurta = await productNamed(m, 'Embroidered Kurta')
        await fetch(`${process.env.DEMO_API ?? 'http://localhost:5000/api/v1'}/stores/${m.storeId}/cart/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Guest-Session-Id': guest }, body: JSON.stringify({ productId: kurta.id, quantity: 1 }) })
        await fetch(`${process.env.DEMO_API ?? 'http://localhost:5000/api/v1'}/stores/${m.storeId}/payments/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Guest-Session-Id': guest }, body: JSON.stringify({ method: 'cod', name: 'Bushra Naveed', phone: '03211234567', email: `${guest}@demo.zyro.local`, address: { line1: '22 Johar Town', city: 'Lahore', country: 'PK' } }) })
      }
      await page.goto(WEB + '/admin/payments')
      await page.getByRole('heading', { name: 'Payments' }).waitFor()
      await page.waitForTimeout(1200)
      f.start()
      await f.say('The courier delivered a cash on delivery order and brought the money back.')
      const cod = page.getByRole('region', { name: 'Cash on delivery' })
      await f.scrollTo(cod)
      await f.click(cod.getByRole('button', { name: 'Cash collected' }).first())
      await page.waitForTimeout(1500)
      await f.say('Marked as collected: the order is paid. Which ways to pay the shop offers stays the owner\'s decision.', 5000)
    },
  },
  {
    slug: 'reviews',
    title: 'Reply to a review',
    setup: manager,
    options: asManager,
    async run(f) {
      const { page } = f
      await page.goto(WEB + '/admin/reviews')
      await page.getByRole('heading', { name: 'Reviews' }).waitFor()
      await page.waitForTimeout(1200)
      f.start()
      await f.say('Every review of the shop\'s products, with its stars and whether it came from a real purchase.')
      const card = page.locator('li, article').filter({ hasText: 'Nice but small' }).first()
      await f.scrollTo(card)
      await f.click(card.getByRole('button', { name: /^(Reply|Edit reply)/ }))
      const box = page.locator('#reply')
      await box.waitFor()
      await f.type(box, 'Thank you, Hamza! We have added the cup size in millilitres to the description.', 30)
      await f.click(page.getByRole('button', { name: 'Post reply' }))
      await page.waitForTimeout(1500)
      await f.say('The shop\'s reply appears under the review for every shopper. A review can also be hidden.', 4500)
    },
  },
  {
    slug: 'discounts',
    title: 'Discount codes',
    setup: manager,
    options: asManager,
    async run(f) {
      const { page } = f
      await page.goto(WEB + '/admin/marketing')
      await page.getByRole('heading', { name: 'Marketing' }).waitFor()
      f.start()
      await f.say('Managers can run discount codes. The weekend sale is over, so CHAI200 is switched off.')
      const off = page.getByRole('button', { name: /Switch off CHAI200|Switch on CHAI200/ }).first()
      await f.click(off)
      await page.waitForTimeout(1500)
      await f.say('Shoppers can no longer use it. Switching it back on is one click.')
      await f.click(page.getByRole('button', { name: /Switch on CHAI200|Switch off CHAI200/ }).first())
      await page.waitForTimeout(1200)
    },
  },
  {
    slug: 'daily-summary',
    title: 'The register\'s daily summary',
    setup: manager,
    options: asManager,
    async run(f, ctx) {
      const { page } = f
      await page.goto(`${WEB}/pos/${ctx.manager.storeId}/summary`)
      await page.getByRole('heading', { name: 'Daily summary' }).waitFor({ timeout: 20000 })
      await page.waitForTimeout(1200)
      f.start()
      await f.say('At the register, a Manager also sees the daily summary that cashiers do not.')
      await f.scrollBy(400)
      await f.say('Sales by payment method, by cashier, the top items and every shift. A drawer that came up short shows in red.', 5000)
    },
  },
  {
    slug: 'owner-only',
    title: 'What stays with the owner',
    setup: manager,
    options: asManager,
    async run(f) {
      const { page } = f
      await page.goto(WEB + '/admin/team')
      await page.getByText('Only the store owner can manage the team.').waitFor({ timeout: 15000 })
      f.start()
      await f.say('Some things are the owner\'s alone. A Manager cannot add staff or change anyone\'s role...', 4500)
      await page.goto(WEB + '/admin/settings')
      await page.getByText("Only the store owner can change the store's settings.").waitFor({ timeout: 15000 })
      await f.say('...or change the store\'s settings, including which ways to pay it accepts...', 4500)
      await page.goto(WEB + '/admin/billing')
      await page.getByText('Only the store owner can see plans and billing.').waitFor({ timeout: 15000 })
      await f.say('...or see the plan and billing. The server refuses these requests too, not only the page.', 5000)
    },
  },
]
