// The Customer's walkthrough: from ZYRO's landing page to tracking an order. One entry per chapter.
// The shopper is a new demo account each time the sign-up chapter is filmed (video-customer-...@demo.zyro.local);
// it and the order it places are kept in output/customer.json so a later chapter can be filmed on its own.
import { join } from 'node:path'
import { WEB, DEMO, OUT, api, showcaseStoreId, signedInState, blurCardsExcept, readJson, writeJson } from '../lib.mjs'

const FILE = join(OUT, 'customer.json')
const STORE_SHORT = 'Chai & Clay'

/** The demo store, and the shopper's session (a guest until the sign-up chapter). */
async function shopper(ctx, browser, { signedIn = false } = {}) {
  if (!ctx.store) ctx.store = await showcaseStoreId()
  const saved = readJson(FILE, {})
  if (signedIn && saved.email && !ctx.signedIn) {
    ctx.state = await signedInState(browser, saved.email, { path: `/store/${ctx.store.storeId}/account/login`, landing: (url) => !url.pathname.endsWith('/login') })
    ctx.signedIn = true
  }
  return ctx
}
const session = (ctx) => ({ ...(ctx.state ? { storageState: ctx.state } : {}), onState: (s) => (ctx.state = s) })
const store = (ctx, path = '') => `${WEB}/store/${ctx.store.storeId}${path}`

export const chapters = [
  {
    slug: 'landing',
    title: 'ZYRO\'s landing page',
    setup: shopper,
    options: session,
    async run(f) {
      const { page } = f
      await page.goto(WEB + '/')
      await page.getByRole('heading', { level: 1 }).waitFor()
      f.start()
      await f.say('A shopper, or a shop owner, first meets ZYRO here.')
      await f.scrollBy(900)
      await f.say('What ZYRO is: an online shop, a till and AI for small Pakistani shops.')
      await f.scrollBy(900)
      await f.say('Shoppers can go straight to the shops listed on ZYRO.')
    },
  },
  {
    slug: 'find-shops',
    title: 'Find a shop',
    setup: shopper,
    options: session,
    async run(f) {
      const { page } = f
      await page.goto(WEB + '/shop')
      await page.getByRole('heading', { name: 'Shops on ZYRO' }).waitFor()
      // Real shops are blurred: only the demo store is shown readable.
      await blurCardsExcept(page, 'main li', STORE_SHORT)
      await page.waitForTimeout(800)
      f.start()
      await f.say('The directory lists the shops on ZYRO. (Real shops are blurred here; only the demo store is shown.)', 4500)
      await f.type(page.getByLabel('Search shops'), 'chai')
      await page.waitForTimeout(1500)
      await f.say('Searching by name or description finds the demo shop, "Chai & Clay Co.".')
    },
  },
  {
    slug: 'store',
    title: 'Open the shop',
    setup: shopper,
    options: session,
    async run(f, ctx) {
      const { page } = f
      await page.goto(WEB + '/shop?q=chai')
      await page.getByRole('heading', { name: 'Shops on ZYRO' }).waitFor()
      await blurCardsExcept(page, 'main li', STORE_SHORT)
      await page.waitForTimeout(800)
      f.start()
      await f.click(page.locator('main li').filter({ hasText: STORE_SHORT }).getByRole('link', { name: 'Visit shop' }))
      await page.waitForURL(`**/store/${ctx.store.storeId}`, { timeout: 20000 })
      await page.getByRole('heading', { name: 'New arrivals' }).waitFor()
      await f.say('The shop\'s own storefront: its name, categories and newest products.')
      await f.scrollBy(700)
      await f.say('Every price shows what the shopper pays, with the MRP crossed out and the saving beside it.', 4500)
    },
  },
  {
    slug: 'category',
    title: 'Browse a category',
    setup: shopper,
    options: session,
    async run(f, ctx) {
      const { page } = f
      await page.goto(store(ctx))
      await page.getByRole('heading', { name: 'New arrivals' }).waitFor()
      f.start()
      await f.say('Browsing by category: Kitchen.')
      await f.click(page.getByRole('navigation', { name: 'Categories' }).getByRole('link', { name: 'Kitchen' }))
      await page.waitForTimeout(1500)
      await f.say('Filters for price and stock, and sorting, sit beside the results.')
    },
  },
  {
    slug: 'search',
    title: 'Search for a product',
    setup: shopper,
    options: session,
    async run(f, ctx) {
      const { page } = f
      await page.goto(store(ctx))
      await page.getByRole('heading', { name: 'New arrivals' }).waitFor()
      f.start()
      await f.say('Searching the shop. Suggestions appear while typing, and small spelling mistakes are forgiven.')
      await f.type(page.getByPlaceholder('Search products'), 'ketle', 120)
      await page.waitForTimeout(1200)
      await page.getByPlaceholder('Search products').press('Enter')
      await page.waitForTimeout(1800)
      await f.say('"ketle" still finds the copper kettle.')
    },
  },
  {
    slug: 'product',
    title: 'The product page: prices and reviews',
    setup: shopper,
    options: session,
    async run(f, ctx) {
      const { page } = f
      await page.goto(store(ctx, '/products'))
      await page.getByRole('link', { name: /Clay Chai Cup/ }).first().waitFor()
      f.start()
      await f.click(page.getByRole('link', { name: /Clay Chai Cup/ }).first())
      await page.getByRole('heading', { name: 'Clay Chai Cup (Set of 4)' }).waitFor()
      await f.say('The product page: the selling price, the MRP crossed out, and the "10% off" badge.')
      await f.scrollTo(page.getByRole('heading', { name: /review/i }).first())
      await f.say('Reviews from other shoppers, with stars, and a mark on those from real purchases.', 4500)
    },
  },
  {
    slug: 'assistant',
    title: 'The AI shopping assistant',
    setup: shopper,
    options: session,
    async run(f, ctx) {
      const { page } = f
      await page.goto(store(ctx))
      await page.getByRole('heading', { name: 'New arrivals' }).waitFor()
      f.start()
      await f.say('Every shop has an AI shopping assistant that knows its products and prices.')
      await f.click(page.getByRole('button', { name: 'Open shopping assistant' }))
      const input = page.getByPlaceholder('Ask about a product...')
      await f.type(input, 'Do you have clay cups for chai? How much is a set?', 45)
      await input.press('Enter')
      await page.getByText('Thinking…').waitFor({ state: 'detached', timeout: 60000 }).catch(() => {})
      await page.waitForTimeout(2500)
      await f.say('It answers from the shop\'s own catalogue, with the real price, and links straight to the product.', 6000)
    },
  },
  {
    slug: 'sign-up',
    title: 'Create a shopper account',
    setup: shopper,
    options: session,
    async run(f, ctx) {
      const { page } = f
      const email = `video-customer-${Date.now().toString(36)}@demo.zyro.local`
      await page.goto(store(ctx, '/account/register'))
      await page.getByLabel('Email').waitFor()
      f.start()
      await f.say('Shoppers can buy as guests, or create an account to follow their orders.')
      await f.type(page.getByLabel('Name (optional)'), 'Sara (demo)')
      await f.type(page.getByLabel('Email'), email)
      await f.type(page.getByLabel('Password'), DEMO.password)
      await f.click(page.getByRole('button', { name: 'Create account' }))
      await page.waitForURL((u) => !u.pathname.endsWith('/register'), { timeout: 20000 })
      await page.waitForTimeout(1500)
      writeJson(FILE, { email })
      ctx.signedIn = true
      await f.say('Signed in. Orders placed now appear in the account, with their delivery status.')
    },
  },
  {
    slug: 'cart',
    title: 'The cart',
    setup: (ctx, browser) => shopper(ctx, browser, { signedIn: true }),
    options: session,
    async run(f, ctx) {
      const { page } = f
      const saved = readJson(FILE, {})
      const token = (await api('POST', '/auth/login', { body: { email: saved.email, password: DEMO.password } })).json.accessToken
      // Filmed again? Start from an empty cart.
      const cart = (await api('GET', `/stores/${ctx.store.storeId}/cart`, { token })).json
      for (const item of cart?.items ?? []) await api('DELETE', `/stores/${ctx.store.storeId}/cart/items/${item.productId}`, { token })
      await page.goto(store(ctx, '/products'))
      await page.getByRole('link', { name: /Clay Chai Cup/ }).first().waitFor()
      f.start()
      await f.say('Adding two sets of chai cups and a candle to the cart.')
      const cups = page.locator('li').filter({ hasText: 'Clay Chai Cup' }).first()
      await f.click(cups.getByRole('button', { name: /Add to cart/ }))
      await f.click(cups.getByRole('button', { name: /Add to cart/ }))
      await f.click(page.locator('li').filter({ hasText: 'Scented Candle' }).first().getByRole('button', { name: /Add to cart/ }))
      await f.click(page.getByRole('link', { name: /^Cart, / }))
      await page.getByRole('heading', { name: 'Your cart' }).waitFor()
      await f.say('The cart, priced by the shop\'s server, so a price can never be changed in the browser.', 4500)
    },
  },
  {
    slug: 'discount-code',
    title: 'A discount code at checkout',
    setup: (ctx, browser) => shopper(ctx, browser, { signedIn: true }),
    options: session,
    async run(f, ctx) {
      const { page } = f
      await page.goto(store(ctx, '/checkout'))
      await page.getByRole('heading', { name: 'Checkout' }).waitFor()
      await page.waitForTimeout(1200)
      f.start()
      await f.say('At checkout: delivery to Lahore costs Rs 150.')
      await f.click(page.getByRole('radio', { name: /^Lahore/ }))
      await f.say('The shopper has a code from the shop\'s Instagram post: WELCOME10.')
      await f.type(page.getByLabel('Discount code'), 'WELCOME10')
      await f.click(page.getByRole('button', { name: 'Apply' }))
      await page.waitForTimeout(2000)
      await f.say('10% off, worked out by the server: the total to pay updates.')
    },
  },
  {
    slug: 'card-payment',
    title: 'Pay by card (Stripe test mode)',
    setup: (ctx, browser) => shopper(ctx, browser, { signedIn: true }),
    options: session,
    async run(f, ctx) {
      const { page } = f
      const saved = readJson(FILE, {})
      await page.goto(store(ctx, '/checkout'))
      await page.getByRole('heading', { name: 'Checkout' }).waitFor()
      await page.getByRole('radio', { name: /^Lahore/ }).check()
      await page.getByLabel('Discount code').fill('WELCOME10')
      await page.getByRole('button', { name: 'Apply' }).click()
      await page.waitForTimeout(1500)
      f.start()
      await f.say('Paying by card. The shopper goes to Stripe\'s secure page: card details never reach the shop.', 4500)
      await f.click(page.getByRole('radio', { name: /^Card/ }))
      await f.click(page.getByRole('button', { name: /^Pay / }))
      await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 })
      await page.locator('#cardNumber').waitFor({ timeout: 30000 })
      await f.say('Stripe in test mode ("Sandbox"): no real money moves. The test card is 4242 4242 4242 4242.', 4500)
      const email = page.locator('#email')
      if (await email.isVisible().catch(() => false)) await f.type(email, saved.email, 25)
      await f.type(page.locator('#shippingName'), 'Sara (demo)', 40)
      await f.type(page.locator('#shippingAddressLine1'), '12 Model Town', 40)
      if (await page.locator('#shippingDependentLocality').isVisible().catch(() => false)) await f.type(page.locator('#shippingDependentLocality'), 'Model Town', 40)
      await f.type(page.locator('#shippingLocality'), 'Lahore', 40)
      if (await page.locator('#shippingPostalCode').isVisible().catch(() => false)) await f.type(page.locator('#shippingPostalCode'), '54700', 40)
      await f.type(page.locator('#cardNumber'), '4242424242424242', 60)
      await f.type(page.locator('#cardExpiry'), '1234', 80)
      await f.type(page.locator('#cardCvc'), '123', 80)
      await f.click(page.getByTestId('hosted-payment-submit-button').or(page.getByRole('button', { name: /^Pay$/ })).first())
      await page.waitForURL(/\/checkout\/success/, { timeout: 60000 })
      ctx.successUrl = page.url()
      writeJson(FILE, { ...saved, successUrl: page.url().replace(WEB, '') })
      await page.getByText(/Order placed|Your order has been placed/).first().waitFor({ timeout: 60000 })
      await page.waitForTimeout(1500)
      await f.say('Paid. The order exists only once Stripe confirms the money moved, then the confirmation shows.', 5000)
      await f.say('With the order number, what was paid, and what the shopper saved on the MRP.', 4000)
    },
  },
  {
    slug: 'cash-on-delivery',
    title: 'A second order, cash on delivery',
    setup: (ctx, browser) => shopper(ctx, browser, { signedIn: true }),
    options: session,
    async run(f, ctx) {
      const { page } = f
      await page.goto(store(ctx, '/products'))
      await page.getByRole('link', { name: /Winter Shawl/ }).first().waitFor()
      f.start()
      await f.say('A second, quick order: a winter shawl, paid in cash when it arrives.')
      await f.click(page.locator('li').filter({ hasText: 'Winter Shawl' }).first().getByRole('button', { name: /Add to cart/ }))
      await page.goto(store(ctx, '/checkout'))
      await page.getByRole('heading', { name: 'Checkout' }).waitFor()
      await page.getByRole('radio', { name: /^Lahore/ }).check()
      await f.click(page.getByRole('radio', { name: /^Cash on delivery/ }))
      await f.type(page.getByLabel('Full name'), 'Sara (demo)', 40)
      await f.type(page.getByLabel('Phone number'), '03001234567', 50)
      await f.type(page.getByLabel('Address', { exact: true }), '12 Model Town', 40)
      await f.type(page.getByLabel('City'), 'Lahore', 40)
      const country = page.getByLabel('Country code')
      if (await country.isVisible().catch(() => false)) await f.type(country, 'PK', 60)
      await f.click(page.getByRole('button', { name: /Place order for/ }))
      await page.getByRole('heading', { name: /your order is placed/i }).waitFor({ timeout: 30000 })
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
      await page.waitForTimeout(800)
      await f.say('Placed: the shopper pays the courier on delivery, and sees what they saved.', 4500)
    },
  },
  {
    slug: 'order-tracking',
    title: 'Track an order',
    setup: (ctx, browser) => shopper(ctx, browser, { signedIn: true }),
    options: session,
    async run(f, ctx) {
      const { page } = f
      const saved = readJson(FILE, {})
      // Off camera, the shop ships the card order with a tracking number (the Owner video shows how).
      const { token, storeId } = ctx.store
      const orders = (await api('GET', `/stores/${storeId}/orders?limit=10&q=${encodeURIComponent(saved.email)}`, { token })).json?.data ?? []
      const paid = orders.find((o) => o.channel === 'online' && o.status !== 'pending') ?? orders[0]
      if (paid) await api('PUT', `/stores/${storeId}/orders/${paid.id}/shipment`, { token, body: { carrier: 'TCS', trackingNumber: 'TCS-DEMO-77120', status: 'shipped' } })
      await page.goto(store(ctx, '/account'))
      await page.getByText('Your orders').first().waitFor({ timeout: 20000 })
      f.start()
      await f.say('Back in the account, the shopper\'s orders and where each one is. The shop has shipped the card order.', 4500)
      await f.click(page.getByRole('link', { name: paid ? new RegExp(`#${paid.orderNumber}\\b`) : /#\d+/ }).first())
      await page.getByText(/Tracking number/).first().waitFor({ timeout: 20000 })
      await f.say('Shipped with TCS, with the tracking number to follow it, and every item at the price paid.', 4500)
    },
  },
]
