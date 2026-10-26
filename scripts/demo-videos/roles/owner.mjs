// The Owner's walkthrough: signing up, then running the prepared demo store. One entry per chapter;
// each starts from a signed-in session and its own page, so it can be filmed again on its own.
import { join } from 'node:path'
import { WEB, DEMO, ASSETS, api, login, showcaseStoreId, signedInState } from '../lib.mjs'

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
      await f.say('A shop owner arrives at ZYRO and starts with one free sign-up.')
      await page.goto(WEB + '/register')
      await page.getByLabel('Email').waitFor()
      await f.say('One form creates the account and the online store together.')
      await f.type(page.getByLabel('Email'), `video-signup-${stamp}@demo.zyro.local`)
      await f.type(page.getByLabel('Password'), 'Demo-Video-2026')
      await f.type(page.getByLabel('Store name'), 'Noor Handicrafts')
      await f.say('The store gets its own web address, shown here before it is created.')
      await f.type(page.getByLabel('Store URL'), `noor-handicrafts-${stamp}`)
      await f.click(page.getByRole('button', { name: 'Create store' }))
      await page.waitForURL('**/admin/**', { timeout: 30000 })
      await page.waitForTimeout(1500)
      await f.say('The store is live straight away, and an empty store is walked through its first steps.')
      await f.say('For the rest of this video we use a prepared demo store with a month of demo sales.', 3500)
    },
  },
  {
    slug: 'sign-in',
    title: 'Sign in to the demo store',
    async run(f) {
      const { page } = f
      await page.goto(WEB + '/login')
      await page.getByLabel('Email').waitFor()
      f.start()
      await f.say('The owner of "Chai & Clay Co.", a demo store, signs in.')
      await f.type(page.getByLabel('Email'), DEMO.owner)
      await f.type(page.getByLabel('Password'), DEMO.password)
      await f.click(page.getByRole('button', { name: /log in|sign in/i }))
      await page.waitForURL('**/admin/**', { timeout: 30000 })
      await page.getByRole('heading', { name: 'Products', level: 1 }).waitFor()
      await f.say('The admin opens on the products. The menu on the left holds everything an owner runs.')
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
      await page.goto(WEB + '/admin/categories')
      await page.getByRole('heading', { name: 'Categories' }).waitFor()
      f.start()
      await f.say('Products are grouped into the store\'s own categories, with a count of products in each.')
      await f.type(page.getByLabel('New category'), 'Gift sets')
      await f.click(page.getByRole('button', { name: 'Add category' }))
      await page.getByRole('cell', { name: 'Gift sets' }).first().waitFor()
      await f.say('"Gift sets" is added. Categories can also be renamed, switched off or deleted when empty.')
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
      await page.goto(WEB + '/admin/products')
      await page.getByRole('heading', { name: 'Products', level: 1 }).waitFor()
      f.start()
      await f.say('Adding a product. Every product has three prices: the MRP, a discount, and the selling price.')
      await f.click(page.getByRole('button', { name: '+ Add product' }))
      await f.type(page.locator('#title'), 'Hand-painted Tea Tray')
      await f.type(page.locator('#description'), 'A wooden tray painted by hand in Multan, with a rim to keep cups steady.', 25)
      await f.type(page.getByLabel('Price (MRP)'), '2400')
      await f.say('The discount can be given as a percentage...')
      await f.click(page.getByRole('button', { name: 'Discount in percent' }))
      await f.type(page.getByLabel('Discount (optional)'), '15')
      await f.say('...and the selling price is worked out at once: MRP minus the discount. It cannot be typed, so it can never be wrong.')
      await f.click(page.getByRole('button', { name: 'Discount in PKR' }))
      await f.say('Switching to rupees converts the same discount: 15% of Rs 2,400 is Rs 360 off.')
      await f.click(page.getByRole('button', { name: 'Discount in percent' }))
      await f.type(page.locator('#stock'), '12')
      await page.getByLabel('Category').selectOption({ label: 'Home decor' })
      await page.waitForTimeout(600)
      const upload = page.locator('input[type="file"]').first()
      await upload.setInputFiles(join(ASSETS, 'products', 'tea-tray.png'))
      await page.waitForTimeout(2500)
      await f.say('A photo, the stock and the category, and the product is ready to save.')
      await f.click(page.getByRole('button', { name: 'Save', exact: true }))
      const row = page.getByRole('row').filter({ hasText: 'Hand-painted Tea Tray' })
      await row.waitFor({ timeout: 20000 })
      await f.scrollTo(row)
      await f.say('In the list: the selling price, the MRP crossed out, and the "15% off" badge shoppers will see.')
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
      const pateela = await product(o, 'Steel Pateela Large')
      const brass = await product(o, 'Brass Lamp')
      await api('PATCH', `/stores/${o.storeId}/products/${brass.id}/stock`, { token: o.token, body: { stock: 8 } })
      await api('PUT', `/stores/${o.storeId}/products/${pateela.id}`, { token: o.token, body: { title: pateela.title, description: pateela.description, actualPrice: 3200, discountType: null, discountValue: null, stock: 30, categoryId: pateela.categoryId, images: pateela.images, tags: pateela.tags } })
      await page.goto(WEB + '/admin/products')
      await page.getByRole('heading', { name: 'Products', level: 1 }).waitFor()
      f.start()
      await f.say('Editing a product: the steel pateela gets a Rs 300 discount for the week.')
      await f.click(page.getByRole('button', { name: 'Edit Steel Pateela Large' }))
      await f.click(page.getByRole('button', { name: 'Discount in PKR' }))
      await f.type(page.getByLabel('Discount (optional)'), '300')
      await page.waitForTimeout(800)
      await f.click(page.getByRole('button', { name: 'Save', exact: true }))
      const row = page.getByRole('row').filter({ hasText: 'Steel Pateela Large' })
      await row.filter({ hasText: /Rs\s300 off/ }).waitFor({ timeout: 20000 })
      await f.scrollTo(row)
      await f.say('Saved: now Rs 2,900, shown as "Rs 300 off".')
      const lamp = page.getByRole('row').filter({ hasText: 'Brass Lamp' })
      await f.scrollTo(lamp)
      await f.say('Stock is changed right in the list. Two more brass lamps arrived:')
      await f.click(page.getByRole('button', { name: 'One more (Stock for Brass Lamp)' }))
      await f.click(page.getByRole('button', { name: 'One more (Stock for Brass Lamp)' }))
      await f.click(page.getByRole('button', { name: 'Save stock for Brass Lamp' }))
      await page.waitForTimeout(1500)
      await f.say('Saved: 10 in stock. The shop and the register see the new count straight away.')
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
      await page.goto(WEB + '/admin/products')
      await page.getByRole('heading', { name: 'Products', level: 1 }).waitFor()
      await page.getByRole('button', { name: 'Edit Clay Chai Cup (Set of 4)' }).click()
      await page.getByText('AI tools').first().waitFor()
      const panel = page.locator('section, div').filter({ has: page.getByText('AI tools', { exact: true }) }).last()
      await page.getByText('AI tools', { exact: true }).first().scrollIntoViewIfNeeded()
      await page.waitForTimeout(800)
      f.start()
      if (tool === 'description') {
        await f.say('The AI tools sit right in the product form. First, a description written from the product\'s own details.')
        await f.click(page.getByRole('button', { name: 'Generate description with AI' }))
        await page.getByLabel('AI description draft').waitFor({ timeout: 60000 })
        await f.scrollTo(page.getByLabel('AI description draft'))
        await f.say('It arrives as a draft. Nothing is published until the owner reads it and chooses to.', 4500)
        await f.click(page.getByRole('button', { name: 'Publish to product' }))
        await page.waitForTimeout(2500)
        await f.say('Published to the product page. Every AI call is counted against the store\'s monthly allowance.')
      } else if (tool === 'categorize') {
        await f.say('The AI can also suggest a category and tags, chosen from the store\'s own categories.')
        const b = page.getByRole('button', { name: 'Suggest category & tags' })
        await f.scrollTo(b)
        await f.click(b)
        const apply = page.getByRole('button', { name: 'Apply', exact: true })
        await apply.waitFor({ timeout: 60000 })
        await f.scrollTo(apply)
        await f.say('A suggested category and tags. Only a suggestion: the owner applies it, or ignores it.', 4500)
        await f.click(apply)
        await f.say('Applied to the form. It is saved with the product only when the owner presses Save.')
      } else if (tool === 'seo') {
        await f.say('Search engines read a page title and description. The AI writes both, within the length limits.')
        const b = page.getByRole('button', { name: 'Generate SEO title & description' })
        await f.scrollTo(b)
        await f.click(b)
        const apply = page.getByRole('button', { name: 'Apply', exact: true })
        await apply.waitFor({ timeout: 60000 })
        await f.scrollTo(apply)
        await f.say('A search title and description, sized for Google. Again only a suggestion.', 4500)
        await f.click(apply)
        await f.scrollTo(page.getByLabel(/Meta title/))
        await f.say('Applied: they fill the meta title and description, saved with the product.')
      } else if (tool === 'marketing') {
        await f.say('Marketing copy for a social post, an email or ad headlines, in the tone the owner picks.')
        const channel = page.getByLabel('Marketing channel')
        await f.scrollTo(channel)
        await channel.selectOption({ label: 'Social media post' }).catch(() => channel.selectOption('social_post'))
        await page.getByLabel('Marketing tone').selectOption({ label: 'Friendly' }).catch(() => page.getByLabel('Marketing tone').selectOption('friendly'))
        await f.type(page.getByLabel('Offer details (optional)'), '10% off this week with code WELCOME10', 35)
        await f.click(page.getByRole('button', { name: 'Write marketing copy' }))
        await page.getByLabel('Marketing copy result').waitFor({ timeout: 60000 })
        await f.scrollTo(page.getByLabel('Marketing copy result'))
        await f.say('Ready to copy into Instagram or WhatsApp, with the offer the owner typed.', 5000)
      } else {
        await f.say('This product has four reviews. The AI sums up what shoppers are saying, for the owner.')
        const b = page.getByRole('button', { name: /Summarize reviews|Regenerate summary/ })
        await f.scrollTo(b)
        await f.click(b)
        await page.getByRole('button', { name: /Regenerate summary/ }).waitFor({ timeout: 60000 })
        await f.scrollTo(page.getByText('Review summary', { exact: true }))
        await f.say('Praise, complaints and themes in a few lines, from the published reviews only.', 5000)
      }
      void panel
    },
  })),
  {
    slug: 'product-scout',
    title: 'Product Scout: what is trending',
    setup: owner,
    options: asOwner,
    async run(f) {
      const { page } = f
      await page.goto(WEB + '/admin/products')
      const panel = page.getByRole('complementary', { name: 'Trending products' })
      await panel.getByText('Top sellers').waitFor({ timeout: 20000 })
      f.start()
      await f.say('Product Scout shows what is selling across ZYRO shops in the same market, to help decide what to stock.')
      await f.say('This is a demo store, so it sees the demo stores\' figures, marked "Demo data".', 4000)
      await f.click(panel.getByRole('button', { name: '30 days' }))
      await page.waitForTimeout(1200)
      await f.say('Each product shows units, orders and how many shops sold it. No shop or customer is ever named.', 4500)
      await f.scrollTo(panel.getByText(/Totals from at least/))
      await f.say('Totals are only shown when enough shops sold a product and no one or two shops dominate it.', 4500)
    },
  },
  {
    slug: 'orders',
    title: 'Orders: ship and fulfil',
    setup: owner,
    options: asOwner,
    async run(f) {
      const { page } = f
      await page.goto(WEB + '/admin/orders')
      await page.getByRole('heading', { name: 'Orders' }).waitFor()
      f.start()
      await f.say('All orders, online and from the register, in one list that can be filtered by status.')
      await f.click(page.getByRole('tab', { name: /^Processing/ }))
      await page.waitForTimeout(1200)
      await f.say('Paid online orders waiting to be packed. Opening one:')
      await f.click(page.getByRole('row').filter({ hasText: 'Processing' }).first().getByRole('button').first())
      await page.getByRole('button', { name: 'Mark fulfilled' }).waitFor({ timeout: 15000 })
      await f.say('The order shows what was bought, the shipping address, and what the shopper saved.', 4000)
      const carrier = page.getByLabel('Carrier')
      if (await carrier.isVisible().catch(() => false)) {
        await f.type(carrier, 'TCS')
        await f.type(page.getByLabel('Tracking number'), 'TCS-DEMO-10423')
        await f.click(page.getByRole('button', { name: 'Mark shipped' }))
        await page.waitForTimeout(1500)
        await f.say('Shipped with the courier\'s tracking number, which the shopper sees in their account. The order is now fulfilled.', 4500)
      } else {
        await f.click(page.getByRole('button', { name: 'Mark fulfilled' }))
        await page.waitForTimeout(1500)
      }
      await f.say('Refunds and cancellations are on the same panel when they are needed.')
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
      await page.goto(WEB + '/admin/orders')
      const heading = page.getByRole('heading', { name: 'Shipping zones' })
      await heading.waitFor()
      // The zones sit below the orders: bring them to the top, clear of the caption band.
      await heading.evaluate((el) => el.scrollIntoView({ block: 'start' }))
      await page.evaluate(() => window.scrollBy(0, -24))
      await page.waitForTimeout(600)
      f.start()
      await f.say('Shipping zones set what delivery costs. The store already charges Rs 150 in Lahore and Rs 250 elsewhere.')
      await f.click(page.getByRole('button', { name: '+ Add zone' }))
      await f.type(page.getByLabel('Zone name'), 'Karachi')
      await f.type(page.getByLabel('Region'), 'Karachi')
      await f.type(page.getByLabel('Rate'), '200')
      await f.click(page.getByRole('button', { name: 'Add', exact: true }))
      await page.getByRole('cell', { name: 'Karachi' }).first().waitFor({ timeout: 15000 })
      await f.say('Shoppers in Karachi now pay Rs 200 for delivery, worked out at checkout.')
    },
  },
  {
    slug: 'payments',
    title: 'Payments: cash on delivery and bank transfers',
    setup: owner,
    options: asOwner,
    async run(f) {
      const { page } = f
      await page.goto(WEB + '/admin/payments')
      await page.getByRole('heading', { name: 'Payments' }).waitFor()
      await page.waitForTimeout(1200)
      f.start()
      await f.say('Pakistani shoppers often pay cash on delivery or by bank transfer. This page tracks both.')
      const cod = page.getByRole('region', { name: 'Cash on delivery' })
      await f.scrollTo(cod)
      await f.say('A cash on delivery order, with a risk score that explains itself.')
      const collected = cod.getByRole('button', { name: 'Cash collected' }).first()
      if (await collected.isVisible().catch(() => false)) {
        await f.click(collected)
        await page.waitForTimeout(1500)
        await f.say('The courier brought the cash: marked as collected.')
      }
      const shots = page.getByRole('region', { name: 'Payment screenshots' })
      await f.scrollTo(shots)
      await f.say('A shopper paid by bank transfer and uploaded the receipt (a demo receipt, fake bank).', 4000)
      const accept = shots.getByRole('button', { name: 'Accept payment' }).first()
      if (await accept.isVisible().catch(() => false)) {
        await f.click(accept)
        await page.waitForTimeout(1500)
        await f.say('Checked against the order and accepted: the order is now paid.')
      }
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
      const code = ['EID15', 'EID16', 'EID17', 'EID18', 'EID19'].find((c) => !(Array.isArray(codes) ? codes : []).includes(c)) ?? `EID${Date.now() % 1000}`
      await page.goto(WEB + '/admin/marketing')
      await page.getByRole('heading', { name: 'Marketing' }).waitFor()
      f.start()
      await f.say('Discount codes for shoppers to type at checkout, or for the cashier at the register.')
      await f.click(page.getByRole('button', { name: '+ New discount code' }))
      await f.type(page.getByLabel('Code (letters, digits, - and _)'), code)
      await page.getByLabel('Percent off').check().catch(() => page.getByText('Percent off').click())
      const value = page.getByLabel(/Percent|Value|Discount/).last()
      await f.type(value, '15')
      await f.type(page.getByLabel('Minimum spend (optional)'), '3000')
      await f.click(page.getByRole('button', { name: 'Create code' }))
      await page.getByText('Discount code created.').waitFor({ timeout: 15000 })
      await f.say(`${code}: 15% off orders over Rs 3,000. Codes can be limited, given an end date, or switched off.`, 4500)
      await f.scrollBy(500)
      await f.say('Further down: sales by category, and the abandoned-cart reminders, which wait until email is set up.', 4500)
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
      // Filmed again? Put the lamp back to its price, so the note changes it once more.
      const lamp = await product(o, 'Brass Lamp')
      await api('PUT', `/stores/${o.storeId}/products/${lamp.id}`, { token: o.token, body: { title: lamp.title, description: lamp.description, actualPrice: 7200, discountType: null, discountValue: null, stock: lamp.stock, categoryId: lamp.categoryId, images: lamp.images, tags: lamp.tags } })
      for (const n of (await api('GET', `/stores/${o.storeId}/voice-notes?status=pending`, { token: o.token })).json ?? []) await api('POST', `/stores/${o.storeId}/voice-notes/${n.id}/discard`, { token: o.token })
      await page.goto(WEB + '/admin/voice-notes')
      await page.getByRole('heading', { name: 'Voice notes' }).waitFor()
      f.start()
      await f.say('Busy at the counter? The owner can say a change out loud instead of typing it.')
      await f.click(page.getByRole('button', { name: /Record a note/ }))
      await f.say('Recording: "Set the price of brass lamp to seven thousand five hundred rupees."', 5900)
      await f.click(page.getByRole('button', { name: /Stop|Done|Record/ }).first())
      await page.getByRole('button', { name: 'Yes, make this change' }).first().waitFor({ timeout: 90000 })
      await f.say('The note is transcribed and turned into a change. Nothing happens until the owner confirms it.', 5000)
      await f.click(page.getByRole('button', { name: 'Yes, make this change' }).first())
      await page.waitForTimeout(2000)
      await f.say('Done: the brass lamp now sells for Rs 7,500. Urdu and Roman Urdu notes work the same way.')
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
      const staff = (await api('GET', `/stores/${o.storeId}/staff`, { token: o.token })).json ?? []
      // The Free plan allows two staff accounts, and the demo store has two. So the chapter starts
      // with the Cashier taken off the team (off camera) and shows the owner adding them back.
      for (const m of (Array.isArray(staff) ? staff : []).filter((m) => m.email === DEMO.cashier)) await api('DELETE', `/stores/${o.storeId}/staff/${m.id}`, { token: o.token })
      await page.goto(WEB + '/admin/team')
      await page.getByRole('heading', { name: 'Team and register' }).waitFor()
      f.start()
      await f.say('The team page. Staff sign in at the register with the email and password the owner sets here.')
      await f.scrollTo(page.getByRole('heading', { name: /Add a cashier or manager/ }))
      await f.say('Adding a cashier who already has a ZYRO account, so no new password is needed.')
      await f.type(page.getByLabel('Name'), 'Cashier (demo)')
      await f.type(page.getByLabel('Email'), DEMO.cashier)
      await page.getByRole('radio', { name: /Cashier/ }).check()
      await f.click(page.getByRole('button', { name: 'Add to team' }))
      const role = page.getByLabel(`Role for ${DEMO.cashier}`)
      await role.waitFor({ timeout: 15000 })
      await f.scrollTo(role)
      await f.say('Added as a Cashier: the register only, with discounts up to the owner\'s limit.')
      await role.selectOption('manager')
      await page.waitForTimeout(1800)
      await f.say('Changing the role is one click: as a Manager they could also run products, orders and discounts.', 4500)
      await role.selectOption('cashier')
      await page.waitForTimeout(1800)
      await f.say('Back to Cashier. Only the owner can add staff or change roles.')
      await f.scrollTo(page.getByRole('heading', { name: 'Cashier discount limit' }))
      await f.say('The owner also sets the biggest discount a cashier may give at the register.')
    },
  },
  {
    slug: 'dashboard',
    title: 'Dashboard and insights',
    setup: owner,
    options: asOwner,
    async run(f) {
      const { page } = f
      await page.goto(WEB + '/admin/dashboard')
      await page.getByRole('heading', { name: 'Dashboard' }).waitFor()
      await page.waitForTimeout(2000)
      f.start()
      await f.say('The dashboard: net sales, orders, average order and refunds, online and at the counter together.')
      await f.click(page.getByRole('group', { name: 'Period', exact: true }).getByRole('button', { name: '30 days' }))
      await page.waitForTimeout(1500)
      await f.say('Four weeks of demo sales. Hovering a day shows that day\'s figures.')
      await f.scrollBy(650)
      await f.say('Below: this week\'s tip, the market trends for the store\'s categories, and the AI allowance used.', 4500)
      await f.scrollBy(650)
      await f.say('And the most recent orders, with a link to each.')
    },
  },
  {
    slug: 'settings',
    title: 'Store settings',
    setup: owner,
    options: asOwner,
    async run(f) {
      const { page } = f
      await page.goto(WEB + '/admin/settings')
      await page.getByRole('heading', { name: 'Settings' }).waitFor()
      f.start()
      await f.say('Settings are for the owner only. The currency is fixed after the first sale, and says why.', 4500)
      await f.scrollTo(page.getByRole('region', { name: 'Public directory' }))
      await f.say('Whether the shop is listed in ZYRO\'s public directory, with a line about it.')
      await f.scrollTo(page.getByRole('region', { name: 'Shared trends' }))
      await f.say('Whether the shop\'s sales count toward the shared trends. On by default, and the owner\'s choice.', 4500)
      await f.scrollBy(700)
      await f.say('And the ways to pay this shop accepts: card, cash on delivery and bank transfer.')
    },
  },
]
