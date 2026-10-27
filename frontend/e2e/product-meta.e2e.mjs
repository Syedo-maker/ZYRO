// A product's meta title and meta description (product form, or the AI's SEO suggestion) reach the
// shop's product page: the browser tab, the description tag and the link-preview tags. Without them,
// the product's own name and description are used. Leaving the page puts the shared tags back.
//
// Setup: the backend (npm run dev or the e2e server) and `npm run dev` in the frontend, then:
//   node e2e/product-meta.e2e.mjs
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
const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

const reg = await api('POST', '/auth/register', { body: { email: `e2e-meta-${suffix}@example.com`, password: 'password123', storeName: `Meta Shop ${suffix}`, storeSlug: `e2e-meta-${suffix}`, currency: 'PKR' } })
const token = reg.json.accessToken
const storeId = (await api('GET', '/users/me/stores', { token })).json[0].id
const storeName = `Meta Shop ${suffix}`
const withSeo = (await api('POST', `/stores/${storeId}/products`, {
  token,
  body: {
    title: 'Copper Chai Kettle',
    description: 'A kettle.',
    actualPrice: 2500,
    stock: 5,
    category: 'Kitchen',
    seoTitle: 'Copper Chai Kettle, Hand-Hammered 1.5L',
    seoDescription: 'Hand-hammered copper kettle with a brass handle. Rs 2,000, delivered across Pakistan.',
  },
})).json
const longDescription = 'A sturdy steel pot for everyday cooking. '.repeat(10).trim()
const plain = (await api('POST', `/stores/${storeId}/products`, { token, body: { title: 'Steel Pot', description: longDescription, actualPrice: 900, stock: 3, category: 'Kitchen' } })).json

const browser = await chromium.launch()
const page = await browser.newPage()
const problems = []
page.on('pageerror', (e) => problems.push(e.message))
const head = () =>
  page.evaluate(() => ({
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content ?? null,
    ogTitle: document.querySelector('meta[property="og:title"]')?.content ?? null,
    ogDescription: document.querySelector('meta[property="og:description"]')?.content ?? null,
    ogType: document.querySelector('meta[property="og:type"]')?.content ?? null,
  }))

try {
  await page.goto(`${WEB}/store/${storeId}`)
  await page.getByRole('heading', { name: 'New arrivals' }).waitFor({ timeout: 15000 })
  const shared = await head()

  await page.goto(`${WEB}/store/${storeId}/products/${withSeo.id}`)
  await page.getByRole('heading', { name: 'Copper Chai Kettle' }).waitFor({ timeout: 15000 })
  await page.waitForFunction(() => document.title.startsWith('Copper Chai Kettle, Hand'))
  const seo = await head()
  check('the tab shows the meta title', seo.title === 'Copper Chai Kettle, Hand-Hammered 1.5L', seo.title)
  check('the description tag is the meta description', seo.description === 'Hand-hammered copper kettle with a brass handle. Rs 2,000, delivered across Pakistan.', seo.description)
  check('link-preview tags carry them too, as a product', seo.ogTitle === seo.title && seo.ogDescription === seo.description && seo.ogType === 'product')

  await page.goto(`${WEB}/store/${storeId}/products/${plain.id}`)
  await page.getByRole('heading', { name: 'Steel Pot' }).waitFor({ timeout: 15000 })
  await page.waitForFunction(() => document.title.startsWith('Steel Pot'))
  const fallback = await head()
  check('without a meta title, the tab shows the product name and the shop', fallback.title === `Steel Pot | ${storeName}`, fallback.title)
  check('without a meta description, the product description is used, cut to about 160 characters at a word', fallback.description.startsWith('A sturdy steel pot') && fallback.description.length <= 160 && fallback.description.endsWith('…'), `${fallback.description.length} chars`)

  // Leaving through the shop's own links (no page reload) puts the shared tags back.
  await page.getByRole('link', { name: /Meta Shop|Home|Shop/ }).first().click()
  await page.waitForFunction((t) => document.title === t, shared.title, { timeout: 10000 })
  const after = await head()
  check('leaving the product page puts the shared title and description back', after.title === shared.title && after.description === shared.description, after.title)
} catch (err) {
  check('browser journey', false, err.message.split('\n')[0])
} finally {
  await browser.close()
}
check('no script errors', problems.length === 0, problems[0])
console.log(failures ? `\n${failures} failed` : '\nAll passed')
process.exit(failures ? 1 : 0)
