// The Manager's walkthrough: everything a Manager runs, then what stays with the owner. One entry per
// chapter. Pages are reached through the sidebar or the header, and every action is announced.
import { WEB, API, DEMO, api, login, showcaseStoreId, signedInState, sidebar } from '../lib.mjs'

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

/**
 * A day at the register for the daily summary, done by the demo cashier: a cash sale, a card sale,
 * and the shift closed Rs 200 short, so the report has a drawer that came up short to show.
 */
async function registerDay(m) {
  const token = await login(DEMO.cashier)
  const shop = `/stores/${m.storeId}/pos`
  const open = (await api('GET', `${shop}/shift`, { token })).json
  if (open?.id) await api('POST', `${shop}/shift/close`, { token, body: { countedCash: open.expectedCash ?? open.openingFloat ?? 0 } })
  await api('POST', `${shop}/shift/open`, { token, body: { openingFloat: 5000 } })
  const cups = await productNamed(m, 'Clay Chai Cup (Set of 4)')
  const lamp = await productNamed(m, 'Brass Lamp')
  await api('POST', `${shop}/sales`, { token, body: { items: [{ productId: cups.id, quantity: 2 }], payments: [{ method: 'cash', amount: cups.salePrice * 2 }] } })
  await api('POST', `${shop}/sales`, { token, body: { items: [{ productId: lamp.id, quantity: 1 }], payments: [{ method: 'card', amount: lamp.salePrice }] } })
  const shift = (await api('GET', `${shop}/shift`, { token })).json
  await api('POST', `${shop}/shift/close`, { token, body: { countedCash: shift.expectedCash - 200, note: 'Demo: Rs 200 short' } })
}

/** Opens the admin where a Manager lands, off camera; the chapter clicks on from there. */
async function startAt(f, path = '/admin/products', heading = 'Products') {
  await f.page.goto(WEB + path)
  await f.page.getByRole('heading', { name: heading, level: 1 }).waitFor({ timeout: 20000 })
  await f.page.waitForTimeout(800)
  f.start()
}

export const chapters = [
  {
    slug: 'sign-in',
    title: 'Sign in as a Manager',
    setup: manager,
    async run(f) {
      const { page } = f
      await page.goto(WEB + '/')
      await page.getByRole('heading', { level: 1 }).waitFor()
      f.start()
      await f.say('Path: ZYRO home page > Log in. A Manager signs in with their own account.')
      await f.click(page.getByRole('link', { name: 'Log in' }).first(), 'Log in')
      await page.getByLabel('Email').waitFor()
      await f.type(page.getByLabel('Email'), DEMO.manager, 'the Manager\'s email')
      await f.type(page.getByLabel('Password'), DEMO.password, 'the password')
      await f.click(page.getByRole('button', { name: /log in|sign in/i }), 'Log in')
      await page.waitForURL('**/admin/**', { timeout: 30000 })
      await page.getByRole('heading', { name: 'Products', level: 1 }).waitFor()
      await f.result(page.locator('aside').first(), 'a Manager\'s sidebar: no Plan & billing, no Settings', 4500)
      await f.say('Signed in as the Manager. The role decides which pages they can use.')
    },
  },
  {
    slug: 'dashboard',
    title: 'Sales figures',
    setup: manager,
    options: asManager,
    async run(f) {
      const { page } = f
      await startAt(f)
      await f.say('Path: Sidebar > Dashboard. Managers see the shop\'s figures.')
      await f.click(sidebar(page, 'Dashboard'), 'Dashboard in the sidebar')
      await page.getByRole('heading', { name: 'Dashboard', level: 1 }).waitFor()
      await page.waitForTimeout(1500)
      await f.result(page.getByRole('region', { name: 'Key figures' }), 'net sales, orders, average order, refunds', 3500)
      await f.say('Step 1: Choose the last 7 days.')
      await f.click(page.getByRole('group', { name: 'Period', exact: true }).getByRole('button', { name: '7 days' }), '7 days')
      await f.scrollBy(600, 'top products and where sales come from')
      await f.say('Top products, online versus in-store, and the latest orders.')
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
      await startAt(f, '/admin/dashboard', 'Dashboard')
      await f.say('Path: Sidebar > Products > Edit. Managers run the catalogue. Candles are slow, so the discount goes up.')
      await f.click(sidebar(page, 'Products'), 'Products in the sidebar')
      await page.getByRole('heading', { name: 'Products', level: 1 }).waitFor()
      await f.click(page.getByRole('button', { name: 'Edit Scented Candle' }), 'Edit (Scented Candle)')
      await page.locator('#title').waitFor()
      await f.say('Step 1: Change the discount from 15% to 20%.')
      await f.type(page.getByLabel('Discount (optional)'), '20', 'discount, 20%')
      await f.result(page.getByLabel('Selling price (what customers pay)'), 'new selling price: Rs 720', 2500)
      await f.scrollTo(page.getByText('AI tools', { exact: true }).first(), 'AI tools')
      await f.result(page.getByText('AI tools', { exact: true }).first().locator('xpath=..'), 'the same AI tools as the owner', 3000)
      await f.say('Step 2: Save.')
      await f.click(page.getByRole('button', { name: 'Save', exact: true }), 'Save')
      const row = page.getByRole('row').filter({ hasText: 'Scented Candle' })
      await row.filter({ hasText: '20% off' }).waitFor({ timeout: 20000 })
      await f.result(row, 'saved: the shop shows "20% off" at once')
    },
  },
  {
    slug: 'orders',
    title: 'Pack and ship orders',
    setup: manager,
    options: asManager,
    async run(f) {
      const { page } = f
      await startAt(f)
      await f.say('Path: Sidebar > Orders. Managers handle the orders.')
      await f.click(sidebar(page, 'Orders'), 'Orders in the sidebar')
      await page.getByRole('heading', { name: 'Orders', level: 1 }).waitFor()
      await f.say('Step 1: Show the paid orders waiting to be shipped, and open one.')
      await f.click(page.getByRole('tab', { name: /^Processing/ }), 'Processing')
      await f.click(page.getByRole('row').filter({ hasText: 'Processing' }).first().getByRole('button').first(), 'the order number')
      await page.getByLabel('Carrier').waitFor({ timeout: 15000 })
      await f.say('Step 2: The courier and its tracking number, then Mark shipped.')
      await f.type(page.getByLabel('Carrier'), 'Leopards', 'courier')
      await f.type(page.getByLabel('Tracking number'), 'LCS-DEMO-55017', 'tracking number')
      await f.click(page.getByRole('button', { name: 'Mark shipped' }), 'Mark shipped')
      await f.result(page.getByText('Shipment', { exact: true }).locator('xpath=..'), 'shipped with Leopards; refunds are here too', 4000)
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
        const call = (path, body) => fetch(`${API}/stores/${m.storeId}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Guest-Session-Id': guest }, body: JSON.stringify(body) })
        await call('/cart/items', { productId: kurta.id, quantity: 1 })
        await call('/payments/orders', { method: 'cod', name: 'Bushra Naveed', phone: '03211234567', email: `${guest}@demo.zyro.local`, address: { line1: '22 Johar Town', city: 'Lahore', country: 'PK' } })
      }
      await startAt(f)
      await f.say('Path: Sidebar > Payments. A courier delivered an order and brought the cash back.')
      await f.click(sidebar(page, 'Payments'), 'Payments in the sidebar')
      await page.getByRole('heading', { name: 'Payments', level: 1 }).waitFor()
      const cod = page.getByRole('region', { name: 'Cash on delivery' })
      await f.result(cod, 'waiting for cash on delivery', 3000)
      await f.say('Step 1: Mark the cash as collected. The order becomes paid.')
      await f.click(cod.getByRole('button', { name: 'Cash collected' }).first(), 'Cash collected')
      await f.result(page.getByRole('status').first(), 'marked paid', 2500)
      await f.say('Which ways to pay the shop accepts stays the owner\'s decision.')
    },
  },
  {
    slug: 'reviews',
    title: 'Reply to a review',
    setup: manager,
    options: asManager,
    async run(f) {
      const { page } = f
      await startAt(f)
      await f.say('Path: Sidebar > Reviews. Every review of the shop\'s products, with its stars.')
      await f.click(sidebar(page, 'Reviews'), 'Reviews in the sidebar')
      await page.getByRole('heading', { name: 'Reviews', level: 1 }).waitFor()
      const card = page.locator('li').filter({ hasText: 'Nice but small' }).first()
      await f.scrollTo(card, 'Hamza\'s 3-star review')
      await f.result(card, 'a 3-star review: "Nice but small"', 3000)
      await f.say('Step 1: Reply to it. The reply appears under the review for every shopper.')
      await f.click(card.getByRole('button', { name: /^(Reply|Edit reply)/ }), 'Reply')
      const box = page.locator('#reply')
      await box.waitFor()
      await f.type(box, 'Thank you, Hamza! We have added the cup size in millilitres to the description.', 'the shop\'s reply', 30)
      await f.click(page.getByRole('button', { name: 'Post reply' }), 'Post reply')
      await f.result(card, 'the shop\'s reply, under the review', 3500)
    },
  },
  {
    slug: 'discounts',
    title: 'Discount codes',
    setup: manager,
    options: asManager,
    async run(f) {
      const { page } = f
      await startAt(f)
      await f.say('Path: Sidebar > Marketing. Managers can run discount codes.')
      await f.click(sidebar(page, 'Marketing'), 'Marketing in the sidebar')
      await page.getByRole('heading', { name: 'Marketing', level: 1 }).waitFor()
      await f.say('Step 1: The weekend sale is over: switch CHAI200 off.')
      await f.click(page.getByRole('button', { name: /Switch off CHAI200|Switch on CHAI200/ }).first(), 'Switch off (CHAI200)')
      await f.result(page.getByRole('row').filter({ hasText: 'CHAI200' }).first(), 'CHAI200 switched off: shoppers can\'t use it', 3000)
      await f.say('Step 2: Switching it back on is one click.')
      await f.click(page.getByRole('button', { name: /Switch on CHAI200|Switch off CHAI200/ }).first(), 'Switch on (CHAI200)')
    },
  },
  {
    slug: 'daily-summary',
    title: 'The register\'s daily summary',
    setup: manager,
    options: asManager,
    before: (ctx) => registerDay(ctx.manager),
    async run(f) {
      const { page } = f
      await startAt(f)
      await f.say('Path: Header > Open register > Daily summary. At the register, a Manager sees a report cashiers do not.')
      // The link opens the register in a new tab, which the video can't follow: show it in this tab.
      const opened = page.context().waitForEvent('page', { timeout: 20000 })
      await f.click(page.getByRole('link', { name: 'Open register' }), 'Open register')
      const tab = await opened
      await tab.waitForURL('**/pos/**', { timeout: 20000 })
      const url = tab.url()
      await tab.close()
      await page.goto(url)
      await f.say('The register opens in its own tab, so a counter computer can keep it open all day.')
      await f.click(page.getByRole('link', { name: 'Daily summary' }), 'Daily summary')
      await page.getByRole('heading', { name: 'Daily summary' }).waitFor({ timeout: 20000 })
      await f.result(page.getByRole('heading', { name: 'Daily summary' }).locator('xpath=..'), 'today\'s sales at the register', 3000)
      await f.scrollBy(400, 'by payment method, by cashier, every shift')
      await f.say('By payment method, by cashier, the top items and every shift. A drawer that came up short shows in red.', 5000)
    },
  },
  {
    slug: 'owner-only',
    title: 'What stays with the owner',
    setup: manager,
    options: asManager,
    async run(f) {
      const { page } = f
      await startAt(f)
      await f.say('Some things are the owner\'s alone. Path: Sidebar > Team & register.')
      await f.click(sidebar(page, 'Team & register'), 'Team & register in the sidebar')
      const team = page.getByText('Only the store owner can manage the team.')
      await team.waitFor({ timeout: 15000 })
      await f.result(team, 'refused: only the owner manages staff and roles', 3500)
      await f.say('Settings (with the ways to pay) and Plan & billing are not even in a Manager\'s sidebar.', 4500)
      await f.say('The server refuses these requests too, so hiding a button is never the only protection.', 4500)
    },
  },
]
