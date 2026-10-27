// The Owner's walkthrough: signing up, then running the prepared demo store. One entry per chapter.
// Every chapter starts where the owner lands after signing in and reaches its page through the
// sidebar, so the viewer sees where each page lives; every click, field and key is announced.
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { WEB, API, DEMO, ASSETS, api, showcaseStoreId, signedInState, sidebar } from '../lib.mjs'

/** The owner's session and store, made once per run and shared by the chapters after sign-up. */
async function owner(ctx, browser) {
  if (!ctx.owner) {
    const { token, storeId } = await showcaseStoreId()
    ctx.owner = { token, storeId, state: await signedInState(browser, DEMO.owner) }
  }
  return ctx.owner
}
const asOwner = (ctx) => ({ storageState: ctx.owner.state, onState: (state) => (ctx.owner.state = state) })
const product = async (o, title) => (await api('GET', `/stores/${o.storeId}/products?limit=50`, { token: o.token })).json.data.find((p) => p.title === title)

/** Opens the admin where the owner lands (the dashboard), off camera; the chapter then clicks from there. */
async function startAt(f, path = '/admin/dashboard', heading = 'Dashboard') {
  await f.page.goto(WEB + path)
  await f.page.getByRole('heading', { name: heading, level: 1 }).waitFor({ timeout: 20000 })
  await f.page.waitForTimeout(800)
  f.start()
}

/** A shopper's cash on delivery order and a bank transfer with its receipt, waiting on the Payments page. */
async function ensurePendingPayments(o) {
  const guestCall = (method, path, guest, body, form) =>
    fetch(`${API}/stores/${o.storeId}${path}`, { method, headers: { 'X-Guest-Session-Id': guest, ...(form ? {} : { 'Content-Type': 'application/json' }) }, body: form ?? JSON.stringify(body) }).then((r) => r.json())
  const place = async (key, method, name) => {
    const guest = `video-guest-${method}-${Date.now()}`
    const p = await product(o, key)
    await guestCall('POST', '/cart/items', guest, { productId: p.id, quantity: 1 })
    return guestCall('POST', '/payments/orders', guest, { method, name, phone: '03001234567', email: `${guest}@demo.zyro.local`, address: { line1: '7 Gulberg III', city: 'Lahore', country: 'PK' } })
  }
  const cod = (await api('GET', `/stores/${o.storeId}/payments/cod/pending`, { token: o.token })).json ?? []
  if (!cod.length) await place('Winter Shawl', 'cod', 'Kiran Shah')
  const proofs = (await api('GET', `/stores/${o.storeId}/payments/proofs?status=pending`, { token: o.token })).json ?? []
  if (!(proofs.data ?? proofs).length) {
    const order = await place('Copper Kettle 1.5L', 'bank_transfer', 'Omar Farooq')
    const form = new FormData()
    form.append('file', new Blob([readFileSync(join(ASSETS, 'receipt.png'))], { type: 'image/png' }), 'receipt.png')
    const { key } = await fetch(`${API}/stores/${o.storeId}/payments/orders/${order.orderId}/proof-image`, { method: 'POST', body: form }).then((r) => r.json())
    await guestCall('POST', `/payments/orders/${order.orderId}/proof`, 'x', { imageKey: key, declaredAmount: order.total, declaredReference: `DEMO-${Date.now() % 1000000}` })
  }
}

export const chapters = [
  {
    slug: 'sign-up',
    title: 'Sign up and create a store',
    async run(f) {
      const { page } = f
      const stamp = Date.now().toString(36)
      await page.goto(WEB + '/')
      await page.getByRole('heading', { level: 1 }).waitFor()
      f.start()
      await f.say('Path: ZYRO home page > Start your store free. A new shop owner starts here.')
      await f.click(page.getByRole('link', { name: 'Start your store free' }).first(), 'Start your store free')
      await page.getByLabel('Store name').waitFor()
      await f.say('Step 1: One short form creates the owner\'s account and the online store together.')
      await f.fields([
        [page.getByLabel('Email'), 'Email'],
        [page.getByLabel('Password'), 'Password'],
        [page.getByLabel('Store name'), 'Store name'],
        [page.getByLabel('Store URL'), 'Store URL'],
      ])
      await f.type(page.getByLabel('Email'), `video-signup-${stamp}@demo.zyro.local`, 'your email')
      await f.type(page.getByLabel('Password'), 'Demo-Video-2026', 'a password (8 or more characters)')
      await f.type(page.getByLabel('Store name'), 'Noor Handicrafts', 'the shop\'s name')
      await f.say('Step 2: The store URL is the shop\'s own web address. Letters, numbers and dashes only.')
      await f.type(page.getByLabel('Store URL'), `noor-handicrafts-${stamp}`, 'the web address')
      await f.click(page.getByRole('button', { name: 'Create store' }), 'Create store')
      await page.waitForURL('**/admin/**', { timeout: 30000 })
      await page.getByRole('heading', { name: 'Products', level: 1 }).waitFor()
      await f.result(page.getByRole('complementary', { name: 'Trending products' }), 'a guide for a new, empty store', 4000)
      await f.say('The store is live at once. For the rest of this video we use a prepared demo store with a month of demo sales.', 5000)
    },
  },
  {
    slug: 'sign-in',
    title: 'Sign in to the demo store',
    async run(f) {
      const { page } = f
      await page.goto(WEB + '/')
      await page.getByRole('heading', { level: 1 }).waitFor()
      f.start()
      await f.say('Path: ZYRO home page > Log in. The owner of "Chai & Clay Co.", a demo store, signs in.')
      await f.click(page.getByRole('link', { name: 'Log in' }).first(), 'Log in')
      await page.getByLabel('Email').waitFor()
      await f.type(page.getByLabel('Email'), DEMO.owner, 'the owner\'s email')
      await f.type(page.getByLabel('Password'), DEMO.password, 'the password')
      await f.click(page.getByRole('button', { name: /log in|sign in/i }), 'Log in')
      await page.waitForURL('**/admin/**', { timeout: 30000 })
      await page.getByRole('heading', { name: 'Products', level: 1 }).waitFor()
      await f.result(page.locator('aside').first(), 'the sidebar: every page the owner runs', 3500)
      await f.say('Signed in as the Owner. The sidebar on the left is how we reach every page in this video.')
    },
  },
  {
    slug: 'categories',
    title: 'Categories',
    setup: owner,
    options: asOwner,
    async run(f, ctx) {
      const { page } = f
      const o = ctx.owner
      // Filmed again? Take away the category this chapter adds, so it can add it once more.
      const old = (await api('GET', `/stores/${o.storeId}/categories`, { token: o.token })).json.find((c) => c.name === 'Gift sets')
      if (old) await api('DELETE', `/stores/${o.storeId}/categories/${old.id}`, { token: o.token })
      await startAt(f)
      await f.say('Path: Sidebar > Categories. Every product belongs to one of the store\'s own categories.')
      await f.click(sidebar(page, 'Categories'), 'Categories in the sidebar')
      await page.getByRole('heading', { name: 'Categories' }).waitFor()
      await f.say('Step 1: Type a name for the new category.')
      await f.type(page.getByLabel('New category'), 'Gift sets', 'category name')
      await f.say('Step 2: Add it. Products can then be put in it.')
      await f.click(page.getByRole('button', { name: 'Add category' }), 'Add category')
      await f.result(page.getByRole('row').filter({ hasText: 'Gift sets' }).first(), '"Gift sets" added, with 0 products')
      await f.say('Categories can also be renamed, switched off, or deleted once empty.')
    },
  },
  {
    slug: 'add-product',
    title: 'Add a product with three prices',
    setup: owner,
    options: asOwner,
    async run(f, ctx) {
      const { page } = f
      const o = ctx.owner
      const old = await product(o, 'Hand-painted Tea Tray')
      if (old) await api('DELETE', `/stores/${o.storeId}/products/${old.id}`, { token: o.token })
      await startAt(f)
      await f.say('Path: Sidebar > Products > + Add product.')
      await f.click(sidebar(page, 'Products'), 'Products in the sidebar')
      await page.getByRole('heading', { name: 'Products', level: 1 }).waitFor()
      await f.click(page.getByRole('button', { name: '+ Add product' }), '+ Add product')
      await page.locator('#title').waitFor()
      await f.say('The form. Every product has three prices: the MRP, an optional discount, and the selling price.')
      await f.fields([
        [page.locator('#title'), 'Title'],
        [page.locator('#description'), 'Description'],
        [page.getByLabel('Price (MRP)'), 'Price (MRP)'],
        [page.getByLabel('Discount (optional)'), 'Discount, in Rs or %'],
        [page.getByLabel('Selling price (what customers pay)'), 'Selling price (worked out for you)'],
        [page.locator('#stock'), 'Stock'],
        [page.getByLabel('Category'), 'Category'],
        [page.getByRole('button', { name: 'Add image' }), 'Photo'],
      ])
      await f.say('Step 1: The name and a short description shoppers will read.')
      await f.type(page.locator('#title'), 'Hand-painted Tea Tray', 'product name')
      await f.type(page.locator('#description'), 'A wooden tray painted by hand in Multan, with a rim to keep cups steady.', 'description', 30)
      await f.say('Step 2: The MRP, the full price before any discount.')
      await f.type(page.getByLabel('Price (MRP)'), '2400', 'MRP in rupees')
      await f.say('Step 3: A discount, here as a percentage. Pick % first.')
      await f.click(page.getByRole('button', { name: 'Discount in percent' }), '% (percent)')
      await f.type(page.getByLabel('Discount (optional)'), '15', 'discount, 15%')
      await f.result(page.getByLabel('Selling price (what customers pay)'), 'selling price: MRP minus 15% = Rs 2,040')
      await f.say('Switching to Rs converts the same discount instead of clearing it: 15% of Rs 2,400 is Rs 360.')
      await f.click(page.getByRole('button', { name: 'Discount in PKR' }), 'Rs (rupees)')
      await f.result(page.getByLabel('Discount (optional)'), 'the same discount, now Rs 360', 2500)
      await f.click(page.getByRole('button', { name: 'Discount in percent' }), '% (percent) again')
      await f.say('Step 4: How many are in stock, and the category. Categories are made first, under Categories.')
      await f.type(page.locator('#stock'), '12', 'stock')
      await f.select(page.getByLabel('Category'), { label: 'Home decor' }, 'category', 'Home decor')
      await f.say('Step 5: A photo of the product.')
      await f.upload(page.getByRole('button', { name: 'Add image' }), page.getByLabel('Product image file'), join(ASSETS, 'products', 'tea-tray.png'), 'product photo')
      await page.waitForTimeout(1500)
      await f.say('Step 6: Save.')
      await f.click(page.getByRole('button', { name: 'Save', exact: true }), 'Save')
      const row = page.getByRole('row').filter({ hasText: 'Hand-painted Tea Tray' })
      await row.waitFor({ timeout: 20000 })
      await f.result(row, 'saved: selling price, MRP crossed out, "15% off"', 4500)
    },
  },
  {
    slug: 'edit-product',
    title: 'Edit a product and its stock',
    setup: owner,
    options: asOwner,
    async run(f, ctx) {
      const { page } = f
      const o = ctx.owner
      const brass = await product(o, 'Brass Lamp')
      await api('PATCH', `/stores/${o.storeId}/products/${brass.id}/stock`, { token: o.token, body: { stock: 8 } })
      const pateela = await product(o, 'Steel Pateela Large')
      await api('PUT', `/stores/${o.storeId}/products/${pateela.id}`, { token: o.token, body: { title: pateela.title, description: pateela.description, actualPrice: 3200, discountType: null, discountValue: null, stock: 30, categoryId: pateela.categoryId, images: pateela.images, tags: pateela.tags } })
      await startAt(f)
      await f.say('Path: Sidebar > Products > Edit. The steel pateela gets a Rs 300 discount for the week.')
      await f.click(sidebar(page, 'Products'), 'Products in the sidebar')
      await page.getByRole('heading', { name: 'Products', level: 1 }).waitFor()
      await f.click(page.getByRole('button', { name: 'Edit Steel Pateela Large' }), 'Edit (Steel Pateela Large)')
      await page.locator('#title').waitFor()
      await f.say('Step 1: Choose Rs, then type the discount.')
      await f.click(page.getByRole('button', { name: 'Discount in PKR' }), 'Rs (rupees)')
      await f.type(page.getByLabel('Discount (optional)'), '300', 'discount, Rs 300')
      await f.result(page.getByLabel('Selling price (what customers pay)'), 'new selling price: Rs 2,900', 2500)
      await f.click(page.getByRole('button', { name: 'Save', exact: true }), 'Save')
      const row = page.getByRole('row').filter({ hasText: 'Steel Pateela Large' })
      await row.filter({ hasText: /Rs\s300 off/ }).waitFor({ timeout: 20000 })
      await f.result(row, 'saved: Rs 2,900, "Rs 300 off"')
      await f.say('Step 2: Stock is changed right in the list. Two more brass lamps arrived.')
      await f.click(page.getByRole('button', { name: 'One more (Stock for Brass Lamp)' }), '+ (one more)')
      await f.click(page.getByRole('button', { name: 'One more (Stock for Brass Lamp)' }), '+ (one more)')
      await f.click(page.getByRole('button', { name: 'Save stock for Brass Lamp' }), 'Save stock')
      await f.result(page.getByRole('row').filter({ hasText: 'Brass Lamp' }), 'saved: 10 in stock, everywhere at once')
    },
  },
  ...['description', 'categorize', 'seo', 'marketing', 'review-summary'].map((tool) => ({
    slug: `ai-${tool}`,
    title: {
      description: 'AI: write a product description',
      categorize: 'AI: suggest a category and tags',
      seo: 'AI: SEO title and description',
      marketing: 'AI: marketing copy',
      'review-summary': 'AI: summarize the reviews',
    }[tool],
    setup: owner,
    options: asOwner,
    async run(f) {
      const { page } = f
      await startAt(f)
      await f.say('Path: Sidebar > Products > Edit (Clay Chai Cup) > AI tools, at the bottom of the form.')
      await f.click(sidebar(page, 'Products'), 'Products in the sidebar')
      await page.getByRole('heading', { name: 'Products', level: 1 }).waitFor()
      await f.click(page.getByRole('button', { name: 'Edit Clay Chai Cup (Set of 4)' }), 'Edit (Clay Chai Cup)')
      await page.getByText('AI tools', { exact: true }).first().waitFor({ timeout: 20000 })
      await f.scrollTo(page.getByText('AI tools', { exact: true }).first(), 'AI tools')
      if (tool === 'description') {
        await f.say('Step 1: The AI writes a description from the product\'s own name, category and price.')
        // A product that already has a description offers "Regenerate" instead.
        const generate = page.getByRole('button', { name: /^(Generate description with AI|Regenerate)$/ })
        const again = (await generate.innerText()).trim() === 'Regenerate'
        await f.click(generate, again ? 'Regenerate (a new description)' : 'Generate description with AI')
        const draft = page.getByLabel('AI description draft')
        await draft.waitFor({ timeout: 60000 })
        await page.getByRole('button', { name: /^(Regenerating|Generating)/ }).waitFor({ state: 'detached', timeout: 60000 }).catch(() => {})
        await page.waitForTimeout(800)
        await f.result(draft, 'the AI\'s draft (nothing published yet)', 6000)
        await f.say('Step 2: The owner reads it and publishes it, or edits it first. Nothing goes live without the owner.', 4500)
        await f.click(page.getByRole('button', { name: 'Publish to product' }), 'Publish to product')
        await f.say('Published to the product page. Each AI use counts against the store\'s monthly AI allowance.')
      } else if (tool === 'categorize') {
        await f.say('Step 1: Ask the AI for a category and tags. It picks from the store\'s own categories.')
        await f.click(page.getByRole('button', { name: 'Suggest category & tags' }), 'Suggest category & tags')
        const apply = page.getByRole('button', { name: 'Apply', exact: true })
        await apply.waitFor({ timeout: 60000 })
        await f.result(apply.locator('xpath=..'), 'the suggested category and tags', 5000)
        await f.say('Step 2: Only a suggestion. Apply puts it in the form; Save keeps it.')
        await f.click(apply, 'Apply')
        await f.result(page.getByLabel('Category'), 'category filled in from the suggestion', 3000)
      } else if (tool === 'seo') {
        await f.say('Step 1: Google shows a page title and a short description. The AI writes both, within the length limits.', 4500)
        await f.click(page.getByRole('button', { name: 'Generate SEO title & description' }), 'Generate SEO title & description')
        const apply = page.getByRole('button', { name: 'Apply', exact: true })
        await apply.waitFor({ timeout: 60000 })
        await f.result(apply.locator('xpath=..'), 'the suggested search title and description', 5500)
        await f.say('Step 2: Apply copies them into the Meta title and Meta description fields.')
        await f.click(apply, 'Apply')
        await f.result(page.getByLabel(/Meta title/), 'Meta title filled in', 3000)
      } else if (tool === 'marketing') {
        await f.say('Step 1: Choose where the post goes and its tone, and type the offer.')
        await f.select(page.getByLabel('Marketing channel'), { label: 'Social media post' }, 'channel', 'Social media post')
        await f.select(page.getByLabel('Marketing tone'), { label: 'Friendly' }, 'tone', 'Friendly')
        await f.type(page.getByLabel('Offer details (optional)'), '10% off this week with code WELCOME10', 'the offer', 40)
        await f.say('Step 2: Write it.')
        await f.click(page.getByRole('button', { name: 'Write marketing copy' }), 'Write marketing copy')
        const out = page.getByLabel('Marketing copy result')
        await out.waitFor({ timeout: 60000 })
        await f.result(out, 'a ready-to-post caption with the offer', 6500)
        await f.say('Copy it into Instagram, Facebook or WhatsApp.')
      } else {
        await f.say('Step 1: This product has four reviews. Ask the AI to sum them up for the owner.')
        await f.click(page.getByRole('button', { name: /Summarize reviews|Regenerate summary/ }), 'Summarize reviews')
        await page.getByRole('button', { name: /Regenerate summary/ }).waitFor({ timeout: 60000 })
        await f.result(page.getByText('Review summary', { exact: true }).locator('xpath=..'), 'what shoppers like, and what they don\'t', 6500)
        await f.say('Written only from the published reviews, so the owner sees the themes at a glance.')
      }
    },
  })),
  {
    slug: 'product-scout',
    title: 'Product Scout: what is trending',
    setup: owner,
    options: asOwner,
    async run(f) {
      const { page } = f
      await startAt(f)
      await f.say('Path: Sidebar > Products > Trending products (the panel on the right).')
      await f.click(sidebar(page, 'Products'), 'Products in the sidebar')
      const panel = page.getByRole('complementary', { name: 'Trending products' })
      await panel.getByText('Top sellers').waitFor({ timeout: 20000 })
      await f.result(panel, 'Product Scout: what sells across ZYRO shops', 4000)
      await f.say('It helps decide what to stock. This is a demo store, so it shows the demo stores\' figures.')
      await f.click(panel.getByRole('button', { name: '30 days' }), '30 days')
      await f.say('Each product shows units sold, orders, how many shops sold it, and the change. No shop or customer is named.', 5000)
      await f.scrollTo(panel.getByText(/Totals from at least/), 'how the figures are protected')
      await f.result(panel.getByText(/Totals from at least/), 'only totals from several shops are shown', 4000)
    },
  },
  {
    slug: 'orders',
    title: 'Orders: ship and fulfil',
    setup: owner,
    options: asOwner,
    async run(f) {
      const { page } = f
      await startAt(f)
      await f.say('Path: Sidebar > Orders. All orders, online and from the register, in one list.')
      await f.click(sidebar(page, 'Orders'), 'Orders in the sidebar')
      await page.getByRole('heading', { name: 'Orders', level: 1 }).waitFor()
      await f.say('Step 1: Show only the paid orders waiting to be packed.')
      await f.click(page.getByRole('tab', { name: /^Processing/ }), 'Processing')
      await f.say('Step 2: Open one by its order number.')
      await f.click(page.getByRole('row').filter({ hasText: 'Processing' }).first().getByRole('button').first(), 'the order number')
      await page.getByLabel('Carrier').waitFor({ timeout: 15000 })
      await f.result(page.getByRole('button', { name: 'Refund' }).locator('xpath=ancestor::*[.//h2 or .//h3][1]'), 'what was bought, the address, and what the shopper saved', 4000)
      await f.say('Step 3: Type the courier and the tracking number, then mark it shipped.')
      await f.type(page.getByLabel('Carrier'), 'TCS', 'courier')
      await f.type(page.getByLabel('Tracking number'), 'TCS-DEMO-10423', 'tracking number')
      await f.click(page.getByRole('button', { name: 'Mark shipped' }), 'Mark shipped')
      await f.result(page.getByText('Shipment', { exact: true }).locator('xpath=..'), 'shipped; the order is now fulfilled', 4000)
      await f.say('The shopper sees the tracking number in their account. Refunds are on the same panel.')
    },
  },
  {
    slug: 'shipping',
    title: 'Shipping zones',
    setup: owner,
    options: asOwner,
    async run(f, ctx) {
      const { page } = f
      const o = ctx.owner
      const zones = (await api('GET', `/stores/${o.storeId}/shipping-zones`, { token: o.token })).json ?? []
      for (const z of (Array.isArray(zones) ? zones : zones.data ?? []).filter((z) => z.name === 'Karachi')) await api('DELETE', `/stores/${o.storeId}/shipping-zones/${z.id}`, { token: o.token })
      await startAt(f)
      await f.say('Path: Sidebar > Orders > Shipping zones (below the orders). Zones set what delivery costs.')
      await f.click(sidebar(page, 'Orders'), 'Orders in the sidebar')
      const heading = page.getByRole('heading', { name: 'Shipping zones' })
      await heading.waitFor()
      await f.scrollTo(page.getByRole('button', { name: '+ Add zone' }), 'Shipping zones')
      await f.say('Step 1: Add a zone for Karachi.')
      await f.click(page.getByRole('button', { name: '+ Add zone' }), '+ Add zone')
      await f.fields([
        [page.getByLabel('Zone name'), 'Zone name'],
        [page.getByLabel('Region'), 'Region'],
        [page.getByLabel('Rate'), 'Rate (delivery charge)'],
      ])
      await f.type(page.getByLabel('Zone name'), 'Karachi', 'zone name')
      await f.type(page.getByLabel('Region'), 'Karachi', 'region')
      await f.type(page.getByLabel('Rate'), '200', 'delivery charge in rupees')
      await f.click(page.getByRole('button', { name: 'Add', exact: true }), 'Add')
      await f.result(page.getByRole('row').filter({ hasText: 'Karachi' }).first(), 'Karachi: Rs 200, charged at checkout')
    },
  },
  {
    slug: 'payments',
    title: 'Payments: cash on delivery and bank transfers',
    setup: owner,
    options: asOwner,
    before: (ctx) => ensurePendingPayments(ctx.owner),
    async run(f) {
      const { page } = f
      await startAt(f)
      await f.say('Path: Sidebar > Payments. Cash on delivery and bank transfers, checked by the shop.')
      await f.click(sidebar(page, 'Payments'), 'Payments in the sidebar')
      await page.getByRole('heading', { name: 'Payments', level: 1 }).waitFor()
      const cod = page.getByRole('region', { name: 'Cash on delivery' })
      await f.result(cod, 'a cash on delivery order, with a risk score', 3500)
      await f.say('Step 1: The courier brought the cash back. Mark it collected.')
      await f.click(cod.getByRole('button', { name: 'Cash collected' }).first(), 'Cash collected')
      const shots = page.getByRole('region', { name: 'Payment screenshots' })
      await f.scrollTo(shots, 'Payment screenshots to check')
      await f.result(shots, 'a bank transfer receipt (a demo receipt) and the checks on it', 4500)
      await f.say('Step 2: The shop compares the receipt with the order, then accepts the payment.')
      await f.click(shots.getByRole('button', { name: 'Accept payment' }).first(), 'Accept payment')
      await f.result(page.getByRole('status').first(), 'the order is now marked paid', 3000)
    },
  },
  {
    slug: 'discounts',
    title: 'Discount codes',
    setup: owner,
    options: asOwner,
    async run(f, ctx) {
      const { page } = f
      const o = ctx.owner
      const codes = ((await api('GET', `/stores/${o.storeId}/discount-codes`, { token: o.token })).json ?? []).map((c) => c.code)
      const code = ['EID15', 'EID16', 'EID17', 'EID18', 'EID19', 'EID20', 'EID21'].find((c) => !(Array.isArray(codes) ? codes : []).includes(c)) ?? `EID${Date.now() % 1000}`
      await startAt(f)
      await f.say('Path: Sidebar > Marketing > + New discount code.')
      await f.click(sidebar(page, 'Marketing'), 'Marketing in the sidebar')
      await page.getByRole('heading', { name: 'Marketing', level: 1 }).waitFor()
      await f.click(page.getByRole('button', { name: '+ New discount code' }), '+ New discount code')
      await f.fields([
        [page.getByLabel('Code (letters, digits, - and _)'), 'Code'],
        [page.getByText('Percent off').first(), 'Type: percent or amount'],
        [page.locator('#dc-value'), 'Value'],
        [page.getByLabel('Minimum spend (optional)'), 'Minimum spend'],
        [page.getByLabel('Usage limit (optional)'), 'Usage limit'],
        [page.getByLabel('Last day (optional)'), 'Last day'],
      ])
      await f.say(`Step 1: A code shoppers type at checkout: ${code}, 15% off orders over Rs 3,000.`)
      await f.type(page.getByLabel('Code (letters, digits, - and _)'), code, 'the code')
      await f.choose(page.getByText('Percent off').first(), 'Percent off')
      await f.type(page.locator('#dc-value'), '15', 'percent off')
      await f.type(page.getByLabel('Minimum spend (optional)'), '3000', 'minimum spend in rupees')
      await f.click(page.getByRole('button', { name: 'Create code' }), 'Create code')
      await page.getByText('Discount code created.').waitFor({ timeout: 15000 })
      await f.result(page.getByRole('row').filter({ hasText: code }).first(), `${code} is active`)
      await f.say('Codes can be switched off at any time. Further down: sales by category.')
    },
  },
  {
    slug: 'voice-notes',
    title: 'Voice notes',
    setup: owner,
    options: (ctx) => ({ ...asOwner(ctx), permissions: ['microphone'] }),
    async run(f, ctx) {
      const { page } = f
      const o = ctx.owner
      // Filmed again? Put the lamp back to its price, and clear notes left waiting.
      const lamp = await product(o, 'Brass Lamp')
      await api('PUT', `/stores/${o.storeId}/products/${lamp.id}`, { token: o.token, body: { title: lamp.title, description: lamp.description, actualPrice: 7200, discountType: null, discountValue: null, stock: lamp.stock, categoryId: lamp.categoryId, images: lamp.images, tags: lamp.tags } })
      for (const n of (await api('GET', `/stores/${o.storeId}/voice-notes?status=pending`, { token: o.token })).json ?? []) await api('POST', `/stores/${o.storeId}/voice-notes/${n.id}/discard`, { token: o.token })
      await startAt(f)
      await f.say('Path: Sidebar > Voice notes. Busy at the counter? Say a change out loud instead of typing it.')
      await f.click(sidebar(page, 'Voice notes'), 'Voice notes in the sidebar')
      await page.getByRole('heading', { name: 'Voice notes', level: 1 }).waitFor()
      await f.say('Step 1: Record a note. English, Urdu or Roman Urdu all work.')
      await f.click(page.getByRole('button', { name: 'Record a note' }), 'Record a note')
      await f.say('Speaking: "Set the price of brass lamp to seven thousand five hundred rupees."', 3500)
      await f.click(page.getByRole('button', { name: 'Stop and send' }), 'Stop and send')
      const confirm = page.getByRole('button', { name: 'Yes, make this change' }).first()
      await confirm.waitFor({ timeout: 90000 })
      await f.result(confirm.locator('xpath=ancestor::*[.//audio][1]'), 'what was heard, and the change it will make', 5000)
      await f.say('Step 2: Nothing changes until the owner confirms.')
      await f.click(confirm, 'Yes, make this change')
      await f.result(page.getByRole('status').first(), 'done: the brass lamp now sells for Rs 7,500', 3500)
    },
  },
  {
    slug: 'team',
    title: 'Team: staff and roles',
    setup: owner,
    options: asOwner,
    async run(f, ctx) {
      const { page } = f
      const o = ctx.owner
      // The Free plan allows two staff accounts, and the demo store has two. So the chapter starts
      // with the Cashier taken off the team (off camera) and shows the owner adding them back.
      const staff = (await api('GET', `/stores/${o.storeId}/staff`, { token: o.token })).json ?? []
      for (const m of (Array.isArray(staff) ? staff : []).filter((m) => m.email === DEMO.cashier)) await api('DELETE', `/stores/${o.storeId}/staff/${m.id}`, { token: o.token })
      await startAt(f)
      await f.say('Path: Sidebar > Team & register. Only the owner can add staff or change their roles.')
      await f.click(sidebar(page, 'Team & register'), 'Team & register in the sidebar')
      await page.getByRole('heading', { name: 'Team and register' }).waitFor()
      await f.scrollTo(page.getByRole('heading', { name: /Add a cashier or manager/ }), 'Add a cashier or manager')
      await f.fields([
        [page.getByLabel('Name'), 'Name'],
        [page.getByLabel('Email'), 'Email'],
        [page.getByLabel(/Starting password/), 'Starting password (new accounts only)'],
        [page.getByRole('radio', { name: /Cashier/ }), 'Role: Cashier or Manager'],
      ])
      await f.say('Step 1: Add a cashier who already has a ZYRO account, so no password is needed.')
      await f.type(page.getByLabel('Name'), 'Cashier (demo)', 'their name')
      await f.type(page.getByLabel('Email'), DEMO.cashier, 'their email')
      await f.choose(page.getByRole('radio', { name: /Cashier/ }), 'Cashier')
      await f.click(page.getByRole('button', { name: 'Add to team' }), 'Add to team')
      const role = page.getByLabel(`Role for ${DEMO.cashier}`)
      await role.waitFor({ timeout: 15000 })
      await f.result(role.locator('xpath=ancestor::li[1]'), 'added as a Cashier: the register only', 3000)
      await f.say('Step 2: Changing a role is one dropdown. As a Manager they could also run products, orders and discounts.', 5000)
      await f.select(role, 'manager', 'role', 'Manager')
      await f.select(role, 'cashier', 'role', 'back to Cashier')
      await f.scrollTo(page.getByRole('heading', { name: 'Cashier discount limit' }), 'Cashier discount limit')
      await f.result(page.getByRole('heading', { name: 'Cashier discount limit' }).locator('xpath=..'), 'the biggest discount a cashier may give', 3500)
    },
  },
  {
    slug: 'dashboard',
    title: 'Dashboard and insights',
    setup: owner,
    options: asOwner,
    async run(f) {
      const { page } = f
      await startAt(f, '/admin/products', 'Products')
      await f.say('Path: Sidebar > Dashboard. The shop\'s figures, online and at the counter together.')
      await f.click(sidebar(page, 'Dashboard'), 'Dashboard in the sidebar')
      await page.getByRole('heading', { name: 'Dashboard', level: 1 }).waitFor()
      await page.waitForTimeout(1500)
      await f.result(page.getByRole('region', { name: 'Key figures' }), 'net sales, orders, average order, refunds', 4000)
      await f.say('Step 1: Choose the period. Here, the last 30 days.')
      await f.click(page.getByRole('group', { name: 'Period', exact: true }).getByRole('button', { name: '30 days' }), '30 days')
      const bars = page.getByRole('region', { name: /Sales per day/ }).getByRole('button')
      await f.hover(bars.nth(20), 'a day in the chart: that day\'s sales', 2500)
      await f.scrollBy(650, 'this week\'s tip, market trends and the AI allowance')
      await f.say('Below: a weekly tip, market trends for the store\'s categories, and how much of the AI allowance is used.', 5000)
      await f.scrollBy(650, 'recent orders')
      await f.result(page.getByRole('region', { name: 'Recent orders' }), 'the latest orders, each one a link', 3500)
    },
  },
  {
    slug: 'settings',
    title: 'Store settings',
    setup: owner,
    options: asOwner,
    async run(f) {
      const { page } = f
      await startAt(f)
      await f.say('Path: Sidebar > Settings. Settings are for the owner only.')
      await f.click(sidebar(page, 'Settings'), 'Settings in the sidebar')
      await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
      await f.result(page.getByRole('region', { name: 'Currency' }), 'the currency, fixed after the first sale (it says why)', 4500)
      await f.scrollTo(page.getByRole('region', { name: 'Public directory' }), 'Public directory')
      await f.result(page.getByRole('region', { name: 'Public directory' }), 'whether the shop is listed in ZYRO\'s shop directory', 4000)
      await f.scrollTo(page.getByRole('region', { name: 'Shared trends' }), 'Shared trends')
      await f.result(page.getByRole('region', { name: 'Shared trends' }), 'whether the shop\'s sales count in shared trends', 4000)
      await f.scrollBy(700, 'Ways to pay')
      await f.say('And the ways to pay the shop accepts: card, cash on delivery and bank transfer.')
    },
  },
]
