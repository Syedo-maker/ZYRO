import { env } from "../../config/env";
import { prismaUnscoped } from "../../lib/prisma";
import { formatPrice } from "../../lib/currencies";
import { logger } from "../../lib/logger";
import { Product } from "../../models/Product.model";
import { directoryService } from "../stores/directory.service";

/**
 * Search engines and link previews (production readiness, 2026-11).
 *
 * - robots.txt: keeps private pages (dashboard, register, cart, checkout, accounts) out of search,
 *   and on anything but production keeps the whole site out, so a staging copy is never indexed.
 * - sitemap.xml: the platform's public pages, and every shop listed in the public directory (the
 *   owner's own choice, and enough products to be worth finding) with its products.
 * - preview: the page WhatsApp, Facebook and similar apps read when someone shares a shop or product
 *   link. They do not run JavaScript, so without this every shared link would show ZYRO's generic
 *   card instead of the shop's name, the product, its price and its photo. The web server sends only
 *   those apps here (frontend/nginx/default.conf.template); people get the normal app.
 */

const base = () => env.storefrontUrl.replace(/\/+$/, "");
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const clamp = (text: string, max = 200) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
};
/** As the storefront shows a price (frontend/src/lib/format.ts): Rs 450, but Rs 99.50. */
const shownPrice = (amount: number, currency: string) => (Number.isInteger(amount) ? formatPrice(amount, currency).replace(/\.00$/, "") : formatPrice(amount, currency));
const absolute = (url: string | null | undefined) => (!url ? null : /^https?:\/\//.test(url) ? url : `${base()}${url.startsWith("/") ? "" : "/"}${url}`);

export function robotsTxt(): string {
  if (env.appEnv !== "production") {
    return ["# Not the live site: nothing here should be in search results.", "User-agent: *", "Disallow: /", ""].join("\n");
  }
  return [
    "User-agent: *",
    "Disallow: /admin",
    "Disallow: /pos",
    "Disallow: /api/",
    "Disallow: /unsubscribe",
    "Disallow: /reset-password",
    "Disallow: /store/*/cart",
    "Disallow: /store/*/checkout",
    "Disallow: /store/*/account",
    "Allow: /",
    "",
    `Sitemap: ${base()}/sitemap.xml`,
    "",
  ].join("\n");
}

/** One sitemap file holds at most 50,000 addresses; past that a sitemap index is needed. */
const MAX_URLS = 45_000;
let cached: { xml: string; at: number } | null = null;
const CACHE_MS = 60 * 60 * 1000;

export async function sitemapXml(): Promise<string> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.xml;

  const urls: { loc: string; lastmod?: Date }[] = ["/", "/shop", "/register", "/terms", "/privacy", "/contact"].map((p) => ({ loc: `${base()}${p === "/" ? "/" : p}` }));

  const shops: { id: string }[] = [];
  for (let offset = 0; ; offset += 60) {
    const page = await directoryService.list({ limit: 60, offset });
    shops.push(...page.stores);
    if (offset + 60 >= page.total) break;
  }
  const tenants = await prismaUnscoped.tenant.findMany({ where: { id: { in: shops.map((s) => s.id) } }, select: { id: true, updatedAt: true } });
  const policies = await prismaUnscoped.storePolicy.groupBy({ by: ["tenantId"], where: { tenantId: { in: shops.map((s) => s.id) } }, _max: { updatedAt: true } });
  const policyDate = new Map(policies.map((p) => [p.tenantId, p._max.updatedAt]));
  for (const t of tenants) {
    urls.push({ loc: `${base()}/store/${t.id}`, lastmod: t.updatedAt }, { loc: `${base()}/store/${t.id}/products` });
    const policiesUpdated = policyDate.get(t.id);
    if (policiesUpdated) urls.push({ loc: `${base()}/store/${t.id}/policies`, lastmod: policiesUpdated });
  }

  if (shops.length > 0) {
    const products = await Product.aggregate<{ _id: unknown; storeId: string; updatedAt?: Date }>([
      { $match: { storeId: { $in: shops.map((s) => s.id) } } },
      { $sort: { updatedAt: -1 } },
      { $limit: MAX_URLS },
      { $project: { _id: 1, storeId: 1, updatedAt: 1 } },
    ]);
    for (const p of products) urls.push({ loc: `${base()}/store/${p.storeId}/products/${String(p._id)}`, lastmod: p.updatedAt });
  }
  if (urls.length > MAX_URLS) {
    logger.warn({ urls: urls.length, max: MAX_URLS }, "the sitemap is full; some products are left out until a sitemap index is added");
    urls.length = MAX_URLS;
  }

  const body = urls
    .map((u) => `  <url><loc>${escape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod.toISOString().slice(0, 10)}</lastmod>` : ""}</url>`)
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  cached = { xml, at: Date.now() };
  return xml;
}

/** Tests only: forget the cached sitemap. */
export function clearSitemapCache() {
  cached = null;
}

const SHOP_PATH = /^\/store\/([a-z0-9]{10,40})(?:\/products\/([a-f0-9]{24}))?\/?$/;
const PLATFORM = {
  title: "ZYRO: a free online shop with AI built in",
  description: "Open a free online shop and let AI write your product titles and descriptions from what shoppers are really searching for.",
  image: "/og-image.svg",
};

/** The link-preview page for a shared address: the shop or product's own title, text and photo. */
export async function previewHtml(path: unknown): Promise<string> {
  const p = typeof path === "string" ? path : "/";
  let card = { ...PLATFORM, url: `${base()}/`, type: "website" };
  const match = SHOP_PATH.exec(p);
  if (match) {
    const [, storeId, productId] = match;
    const store = await prismaUnscoped.tenant.findUnique({ where: { id: storeId }, select: { id: true, name: true, description: true, logoUrl: true, currency: true } });
    if (store) {
      card = { title: store.name, description: clamp(store.description || `Shop ${store.name} online on ZYRO.`), image: store.logoUrl ?? PLATFORM.image, url: `${base()}/store/${store.id}`, type: "website" };
      if (productId) {
        const product = await Product.findOne({ storeId, _id: productId }).select({ title: 1, description: 1, images: 1, salePrice: 1 }).lean();
        if (product) {
          const price = product.salePrice ? shownPrice(Number(product.salePrice.toString()), store.currency) : null;
          card = {
            title: `${product.title} | ${store.name}`,
            description: clamp(`${price ? `${price}. ` : ""}${product.description ?? ""}`) || `${product.title} at ${store.name}.`,
            image: product.images?.[0] ?? card.image,
            url: `${base()}/store/${store.id}/products/${productId}`,
            type: "product",
          };
        }
      }
    }
  }
  const image = absolute(card.image);
  const meta = [
    ["property", "og:title", card.title],
    ["property", "og:description", card.description],
    ["property", "og:type", card.type],
    ["property", "og:url", card.url],
    ["property", "og:site_name", "ZYRO"],
    ...(image ? [["property", "og:image", image]] : []),
    ["name", "twitter:card", image ? "summary_large_image" : "summary"],
    ["name", "description", card.description],
  ]
    .map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escape(value)}">`)
    .join("\n    ");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${escape(card.title)}</title>
    <link rel="canonical" href="${escape(card.url)}">
    ${meta}
  </head>
  <body><p><a href="${escape(card.url)}">${escape(card.title)}</a></p></body>
</html>
`;
}
