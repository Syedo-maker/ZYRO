// The Customer's walkthrough: from ZYRO's landing page to tracking an order. One entry per chapter.
// The shopper reaches every page by clicking (links, the header, the menu), and every action is
// announced. The shopper is a new demo account each time the sign-up chapter is filmed
// (video-customer-...@demo.zyro.local); it is kept in output/customer.json so a later chapter can be
// filmed on its own.
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
const signedIn = (ctx, browser) => shopper(ctx, browser, { signedIn: true })

/** Opens the shop's home page, off camera (where the last chapter left the shopper). */
async function atShop(f, ctx) {
  await f.page.goto(`${WEB}/store/${ctx.store.storeId}`)
  await f.page.getByRole('heading', { name: 'New arrivals' }).waitFor({ timeout: 20000 })
  await f.page.waitForTimeout(800)
  f.start()
}
/** The shopper's own API token (the account the sign-up chapter made). */
async function shopperToken() {
  const saved = readJson(FILE, {})
  return (await api('POST', '/auth/login', { body: { email: saved.email, password: DEMO.password } })).json.accessToken
}
/** Empties the shopper's cart, and fills it with `items` ([title, quantity]) when given. */
async function setCart(ctx, items = []) {
  const token = await shopperToken()
  const { storeId } = ctx.store
  const cart = (await api('GET', `/stores/${storeId}/cart`, { token })).json
  for (const item of cart?.items ?? []) await api('DELETE', `/stores/${storeId}/cart/items/${item.productId}`, { token })
  if (!items.length) return
  const products = (await api('GET', `/stores/${storeId}/products?limit=50`, { token: ctx.store.token })).json.data
  for (const [title, quantity] of items) await api('POST', `/stores/${storeId}/cart/items`, { token, body: { productId: products.find((p) => p.title === title).id, quantity } })
}
const CART = [['Clay Chai Cup (Set of 4)', 2], ['Scented Candle', 1]]

const nav = (page, name) => page.getByRole('navigation', { name: 'Categories' }).getByRole('link', { name, exact: true })
const productCard = (page, name) => page.locator('li').filter({ hasText: name }).first()

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
      await f.say('Path: ZYRO home page. A shopper, or a shop owner, first meets ZYRO here.')
      await f.result(page.getByRole('heading', { level: 1 }), 'what ZYRO is about', 3000)
      await f.scrollBy(900, 'what ZYRO does')
      await f.say('An online shop, a till and AI tools, made for small shops in Pakistan.')
      await f.scrollBy(-900, 'back to the top')
      await f.result(page.getByRole('link', { name: 'Shop now' }).first(), 'shoppers start here: Shop now', 3000)
    },
  },
  {
    slug: 'find-shops',
    title: 'Find a shop',
    setup: shopper,
    options: session,
    async run(f) {
      const { page } = f
      await page.goto(WEB + '/')
      await page.getByRole('heading', { level: 1 }).waitFor()
      f.start()
      await f.say('Path: ZYRO home page > Shop now. The directory of shops on ZYRO.')
      await f.click(page.getByRole('link', { name: 'Shop now' }).first(), 'Shop now')
      await page.getByRole('heading', { name: 'Shops on ZYRO' }).waitFor()
      // Real shops are blurred: only the demo store is shown readable.
      await blurCardsExcept(page, 'main li', STORE_SHORT)
      await page.waitForTimeout(800)
      await f.say('Real shops are blurred in this video; only the demo store is shown.')
      await f.say('Step 1: Search for a shop by name or what it sells.')
      await f.type(page.getByLabel('Search shops'), 'chai', 'what you are looking for')
      await f.press('Enter', page.getByLabel('Search shops'), 'search')
      await f.result(page.locator('main li').filter({ hasText: STORE_SHORT }).first(), 'the demo shop: "Chai & Clay Co."', 3500)
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
      await f.say('Path: Shops on ZYRO > Visit shop.')
      await f.click(page.locator('main li').filter({ hasText: STORE_SHORT }).getByRole('link', { name: 'Visit shop' }), 'Visit shop')
      await page.waitForURL(`**/store/${ctx.store.storeId}`, { timeout: 20000 })
      await page.getByRole('heading', { name: 'New arrivals' }).waitFor()
      await f.result(page.getByRole('navigation', { name: 'Categories' }), 'the shop\'s menu: its categories', 3000)
      await f.scrollTo(page.getByRole('heading', { name: 'New arrivals' }), 'New arrivals')
      await f.result(productCard(page, 'Winter Shawl'), 'price paid, MRP crossed out, and the saving', 4000)
    },
  },
  {
    slug: 'category',
    title: 'Browse a category',
    setup: shopper,
    options: session,
    async run(f, ctx) {
      const { page } = f
      await atShop(f, ctx)
      await f.say('Path: shop menu > Kitchen.')
      await f.click(nav(page, 'Kitchen'), 'Kitchen')
      await page.getByRole('heading', { name: 'Kitchen' }).first().waitFor({ timeout: 15000 })
      await f.result(page.getByRole('heading', { name: 'Kitchen' }).first(), 'only kitchen products', 2500)
      await f.say('Filters for price and stock, and sorting, are on the page too.')
    },
  },
  {
    slug: 'search',
    title: 'Search for a product',
    setup: shopper,
    options: session,
    async run(f, ctx) {
      const { page } = f
      await atShop(f, ctx)
      await f.say('Step 1: Search the shop. Small spelling mistakes are forgiven.')
      await f.type(page.getByPlaceholder('Search products'), 'ketle', 'what you want (spelt "ketle")', 130)
      await f.press('Enter', page.getByPlaceholder('Search products'), 'search')
      await page.getByRole('heading', { name: /Results for/ }).waitFor({ timeout: 15000 })
      await f.result(productCard(page, 'Copper Kettle'), '"ketle" still finds the copper kettle', 3500)
    },
  },
  {
    slug: 'product',
    title: 'The product page: prices and reviews',
    setup: shopper,
    options: session,
    async run(f, ctx) {
      const { page } = f
      await atShop(f, ctx)
      await f.say('Path: shop menu > All products > Clay Chai Cup.')
      await f.click(nav(page, 'All products'), 'All products')
      await f.click(page.getByRole('link', { name: /Clay Chai Cup/ }).first(), 'Clay Chai Cup (Set of 4)')
      await page.getByRole('heading', { name: 'Clay Chai Cup (Set of 4)' }).waitFor()
      await f.result(page.getByRole('heading', { name: 'Clay Chai Cup (Set of 4)' }).locator('xpath=..'), 'price paid, MRP crossed out, "10% off"', 4000)
      await f.scrollTo(page.getByRole('heading', { name: /Customer reviews/i }).first(), 'Customer reviews')
      await f.result(page.getByRole('heading', { name: /Customer reviews/i }).first().locator('xpath=..'), 'stars and reviews from other shoppers', 4000)
    },
  },
  {
    slug: 'assistant',
    title: 'The AI shopping assistant',
    setup: shopper,
    options: session,
    async run(f, ctx) {
      const { page } = f
      await atShop(f, ctx)
      await f.say('Every shop has an AI shopping assistant. It knows the shop\'s products and prices.')
      await f.click(page.getByRole('button', { name: 'Open shopping assistant' }), 'the chat button')
      const input = page.getByPlaceholder('Ask about a product...')
      await f.say('Step 1: Ask in your own words.')
      await f.type(input, 'Do you have clay cups for chai? How much is a set?', 'your question', 45)
      await f.press('Enter', input, 'send')
      await page.getByText('Thinking…').waitFor({ state: 'detached', timeout: 60000 }).catch(() => {})
      await page.waitForTimeout(1500)
      await f.result(page.getByRole('dialog', { name: 'Shopping assistant' }).or(page.getByText('Ask us anything').locator('xpath=ancestor::*[2]')).first(), 'the answer, with the real price and a link', 7000)
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
      await atShop(f, ctx)
      await f.say('Path: header > Sign in > Create an account. An account lets the shopper follow their orders.')
      await f.click(page.getByRole('link', { name: 'Sign in', exact: true }), 'Sign in')
      await f.click(page.getByRole('link', { name: /Create an account/ }), 'Create an account')
      await page.getByLabel('Email').waitFor()
      await f.fields([
        [page.getByLabel('Name (optional)'), 'Name (optional)'],
        [page.getByLabel('Email'), 'Email'],
        [page.getByLabel('Password'), 'Password'],
      ])
      await f.type(page.getByLabel('Name (optional)'), 'Sara (demo)', 'your name')
      await f.type(page.getByLabel('Email'), email, 'your email')
      await f.type(page.getByLabel('Password'), DEMO.password, 'a password')
      await f.click(page.getByRole('button', { name: 'Create account' }), 'Create account')
      await page.waitForURL((u) => !u.pathname.endsWith('/register'), { timeout: 20000 })
      writeJson(FILE, { email })
      ctx.signedIn = true
      await f.result(page.getByText('Your orders').first().locator('xpath=..'), 'signed in: orders will appear here', 3500)
    },
  },
  {
    slug: 'cart',
    title: 'The cart',
    setup: signedIn,
    options: session,
    // Filmed again? Start from an empty cart.
    before: (ctx) => setCart(ctx),
    async run(f, ctx) {
      const { page } = f
      await atShop(f, ctx)
      await f.say('Path: shop menu > All products. Add two sets of chai cups and a candle.')
      await f.click(nav(page, 'All products'), 'All products')
      const cups = productCard(page, 'Clay Chai Cup')
      await f.click(cups.getByRole('button', { name: /Add to cart/ }), 'Add to cart (cups)')
      await f.click(cups.getByRole('button', { name: /Add to cart/ }), 'Add to cart (a second set)')
      await f.click(productCard(page, 'Scented Candle').getByRole('button', { name: /Add to cart/ }), 'Add to cart (candle)')
      await f.say('Path: header > Cart.')
      await f.click(page.getByRole('link', { name: /^Cart, / }), 'Cart')
      await page.getByRole('heading', { name: 'Your cart' }).waitFor()
      await f.result(page.getByRole('region', { name: 'Order summary' }).or(page.getByText('Order summary').first().locator('xpath=..')).first(), 'priced by the shop, not the browser', 4000)
    },
  },
  {
    slug: 'discount-code',
    title: 'A discount code at checkout',
    setup: signedIn,
    options: session,
    // Filmed on its own? The cart chapter's cart: two sets of cups and a candle.
    before: (ctx) => setCart(ctx, CART),
    async run(f, ctx) {
      const { page } = f
      await atShop(f, ctx)
      await f.say('Path: header > Cart > Proceed to checkout.')
      await f.click(page.getByRole('link', { name: /^Cart, / }), 'Cart')
      await f.click(page.getByRole('link', { name: 'Proceed to checkout' }).or(page.getByRole('button', { name: 'Proceed to checkout' })).first(), 'Proceed to checkout')
      await page.getByRole('heading', { name: 'Checkout' }).waitFor()
      await f.say('Step 1: Choose delivery. Lahore costs Rs 150.')
      await f.choose(page.getByRole('radio', { name: /^Lahore/ }), 'Lahore (Rs 150)')
      await f.say('Step 2: The shopper has a code from the shop\'s Instagram: WELCOME10.')
      await f.type(page.getByLabel('Discount code'), 'WELCOME10', 'discount code')
      await f.click(page.getByRole('button', { name: 'Apply' }), 'Apply')
      await page.waitForTimeout(1500)
      await f.result(page.getByRole('complementary', { name: 'Order summary' }).or(page.getByLabel('Order summary')).first(), '10% off, worked out by the server', 4000)
    },
  },
  {
    slug: 'card-payment',
    title: 'Pay by card (Stripe test mode)',
    setup: signedIn,
    options: session,
    // Filmed on its own? The cart chapter's cart: two sets of cups and a candle.
    before: (ctx) => setCart(ctx, CART),
    async run(f, ctx) {
      const { page } = f
      const saved = readJson(FILE, {})
      await page.goto(`${WEB}/store/${ctx.store.storeId}/checkout`)
      await page.getByRole('heading', { name: 'Checkout' }).waitFor()
      await page.getByRole('radio', { name: /^Lahore/ }).check()
      await page.getByLabel('Discount code').fill('WELCOME10')
      await page.getByRole('button', { name: 'Apply' }).click()
      await page.waitForTimeout(1500)
      f.start()
      await f.say('Continuing at checkout (delivery and code already chosen). Step 1: Pay by card.')
      await f.choose(page.getByRole('radio', { name: /^Card/ }), 'Card')
      await f.click(page.getByRole('button', { name: /^Pay / }), 'Pay')
      await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 })
      await page.locator('#cardNumber').waitFor({ timeout: 30000 })
      await f.say('Stripe\'s secure page, in test mode ("Sandbox"): no real money moves. Card details never reach the shop.', 5000)
      const email = page.locator('#email')
      if (await email.isEditable().catch(() => false)) await f.type(email, saved.email, 'email', 25)
      await f.type(page.locator('#shippingName'), 'Sara (demo)', 'full name', 40)
      await f.type(page.locator('#shippingAddressLine1'), '12 Model Town', 'address', 40)
      if (await page.locator('#shippingDependentLocality').isVisible().catch(() => false)) await f.type(page.locator('#shippingDependentLocality'), 'Model Town', 'area', 40)
      await f.type(page.locator('#shippingLocality'), 'Lahore', 'city', 40)
      if (await page.locator('#shippingPostalCode').isVisible().catch(() => false)) await f.type(page.locator('#shippingPostalCode'), '54700', 'postal code', 40)
      await f.say('Step 2: The test card 4242 4242 4242 4242, any future date, any 3 digits.')
      await f.type(page.locator('#cardNumber'), '4242424242424242', 'card number (test card)', 60)
      await f.type(page.locator('#cardExpiry'), '1234', 'expiry (MM / YY)', 80)
      await f.type(page.locator('#cardCvc'), '123', 'CVC', 80)
      await f.click(page.getByTestId('hosted-payment-submit-button').or(page.getByRole('button', { name: /^Pay$/ })).first(), 'Pay')
      await page.waitForURL(/\/checkout\/success/, { timeout: 60000 })
      writeJson(FILE, { ...saved, successUrl: page.url().replace(WEB, '') })
      const done = page.getByText(/Order confirmed|Order placed|Your order has been placed/).first()
      await done.waitFor({ timeout: 60000 })
      await f.say('The order exists only once Stripe confirms the money moved.')
      await f.result(done.locator('xpath=ancestor::*[3]'), 'order confirmed: number, amount paid, "You saved"', 6000)
    },
  },
  {
    slug: 'cash-on-delivery',
    title: 'A second order, cash on delivery',
    setup: signedIn,
    options: session,
    // A second order of its own: the shawl only.
    before: (ctx) => setCart(ctx),
    async run(f, ctx) {
      const { page } = f
      await atShop(f, ctx)
      await f.say('A second, quick order, paid in cash when it arrives. Path: shop menu > All products.')
      await f.click(nav(page, 'All products'), 'All products')
      await f.click(productCard(page, 'Winter Shawl').getByRole('button', { name: /Add to cart/ }), 'Add to cart (shawl)')
      await f.click(page.getByRole('link', { name: /^Cart, / }), 'Cart')
      await f.click(page.getByRole('link', { name: 'Proceed to checkout' }).or(page.getByRole('button', { name: 'Proceed to checkout' })).first(), 'Proceed to checkout')
      await page.getByRole('heading', { name: 'Checkout' }).waitFor()
      await f.choose(page.getByRole('radio', { name: /^Lahore/ }), 'Lahore (Rs 150)')
      await f.say('Step 1: Choose cash on delivery, then the delivery details.')
      await f.choose(page.getByRole('radio', { name: /^Cash on delivery/ }), 'Cash on delivery')
      await f.type(page.getByLabel('Full name'), 'Sara (demo)', 'full name', 40)
      await f.type(page.getByLabel('Phone number'), '03001234567', 'phone number (the courier calls it)', 50)
      await f.type(page.getByLabel('Address', { exact: true }), '12 Model Town', 'address', 40)
      await f.type(page.getByLabel('City'), 'Lahore', 'city', 40)
      const country = page.getByLabel('Country code')
      if (await country.isVisible().catch(() => false)) await f.type(country, 'PK', 'country code', 60)
      await f.click(page.getByRole('button', { name: /Place order for/ }), 'Place order')
      const placed = page.getByRole('heading', { name: /your order is placed/i })
      await placed.waitFor({ timeout: 30000 })
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
      await page.waitForTimeout(800)
      await f.result(placed.locator('xpath=..'), 'placed: pay the courier on delivery, and what was saved', 5000)
    },
  },
  {
    slug: 'order-tracking',
    title: 'Track an order',
    setup: signedIn,
    options: session,
    // Off camera, the shop ships the card order with a tracking number (the Owner video shows how).
    async before(ctx) {
      const { token, storeId } = ctx.store
      // The shopper's own orders; the card order is the paid one (cash on delivery stays pending).
      const mine = (await api('GET', `/stores/${storeId}/orders/mine?limit=10`, { token: await shopperToken() })).json
      ctx.paid = (mine?.data ?? []).find((o) => o.channel === 'online' && o.status !== 'pending')
      if (!ctx.paid) throw new Error('No paid card order to track: film the card-payment chapter first')
      await api('PUT', `/stores/${storeId}/orders/${ctx.paid.id}/shipment`, { token, body: { carrier: 'TCS', trackingNumber: 'TCS-DEMO-77120', status: 'shipped' } })
    },
    async run(f, ctx) {
      const { page } = f
      const { paid } = ctx
      await atShop(f, ctx)
      await f.say('The shop has shipped the card order. Path: header > Sara (the account) > the order.')
      await f.click(page.getByRole('link', { name: 'Sara', exact: true }).or(page.getByRole('link', { name: /Sara/ })).first(), 'Sara (your account)')
      await page.getByText('Your orders').first().waitFor({ timeout: 20000 })
      await f.result(page.getByText('Your orders').first().locator('xpath=..'), 'every order and where it is', 3500)
      await f.click(page.getByRole('link', { name: paid ? new RegExp(`#${paid.orderNumber}\\b`) : /#\d+/ }).first(), paid ? `order #${paid.orderNumber}` : 'the order')
      const tracking = page.getByText(/Tracking number/).first()
      await tracking.waitFor({ timeout: 20000 })
      await f.result(tracking.locator('xpath=ancestor::section[1]'), 'shipped with TCS: the tracking number to follow it', 5000)
    },
  },
]
