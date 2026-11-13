/**
 * Search engines and link previews (modules/seo): robots.txt keeps private pages (and any non-live
 * copy) out of search; the sitemap lists only shops their owners made public; the preview page gives
 * WhatsApp and Facebook the shop's or product's own card, with every value escaped.
 */
process.env.RATE_LIMIT_ENABLED = "false";

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let Product: typeof import("../../src/models/Product.model").Product;
let seo: typeof import("../../src/modules/seo/seo.service");
let env: typeof import("../../src/config/env").env;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };
let listed: { storeId: string; token: string; productIds: string[] };
let hidden: { storeId: string; token: string; productIds: string[] };

async function shop(tag: string, products: string[]) {
  const reg = await request(app).post("/api/v1/auth/register").send({ email: `verify-seo-${tag}-${suffix}@example.com`, password: "password123", storeName: `SEO ${tag} "Chai" & <Co>`, storeSlug: `verify-seo-${tag}-${suffix}`, currency: "PKR" });
  const token = reg.body.accessToken as string;
  const storeId = (await request(app).get("/api/v1/users/me/stores").set("Authorization", `Bearer ${token}`)).body[0].id as string;
  created.tenantIds.push(storeId);
  created.userIds.push(reg.body.user.id);
  const productIds: string[] = [];
  for (const title of products) {
    const res = await request(app).post(`/api/v1/stores/${storeId}/products`).set("Authorization", `Bearer ${token}`).send({ title, description: "Hand-thrown clay cup, fired in Multan. Holds 200 ml.", price: 450, stock: 5, category: "kitchen" });
    productIds.push(res.body.id);
  }
  return { storeId, token, productIds };
}

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ Product } = await import("../../src/models/Product.model"));
  ({ env } = await import("../../src/config/env"));
  seo = await import("../../src/modules/seo/seo.service");
  await (await import("../../src/lib/mongo")).connectMongo();
  listed = await shop("listed", ['Clay cup <script>alert("x")</script>', "Clay jug", "Clay plate"]);
  hidden = await shop("hidden", ["Secret cup", "Secret jug", "Secret plate"]);
  await request(app).patch(`/api/v1/stores/${hidden.storeId}/branding`).set("Authorization", `Bearer ${hidden.token}`).send({ listedInDirectory: false });
}, 90_000);

afterAll(async () => {
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

describe("robots.txt", () => {
  it("outside production, keeps the whole site out of search", async () => {
    const res = await request(app).get("/api/v1/seo/robots.txt");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.text).toMatch(/^User-agent: \*\nDisallow: \/\n/m);
    expect(res.text).not.toMatch(/Sitemap:/);
  });

  it("in production, keeps private pages out and points to the sitemap", () => {
    const before = env.appEnv;
    (env as { appEnv: string }).appEnv = "production";
    try {
      const text = seo.robotsTxt();
      for (const path of ["/admin", "/pos", "/api/", "/store/*/cart", "/store/*/checkout", "/store/*/account", "/unsubscribe"]) expect(text).toContain(`Disallow: ${path}\n`);
      expect(text).not.toMatch(/^Disallow: \/$/m);
      expect(text).toMatch(/^Sitemap: https?:\/\/\S+\/sitemap\.xml$/m);
    } finally {
      (env as { appEnv: string }).appEnv = before;
    }
  });
});

describe("sitemap.xml", () => {
  it("lists the platform pages, a listed shop and its products, and never a shop that opted out", async () => {
    seo.clearSitemapCache();
    const res = await request(app).get("/api/v1/seo/sitemap.xml");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/xml/);
    expect(res.text).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
    for (const p of ["/shop</loc>", "/privacy</loc>", "/contact</loc>"]) expect(res.text).toContain(p);
    expect(res.text).toContain(`/store/${listed.storeId}</loc>`);
    for (const id of listed.productIds) expect(res.text).toContain(`/store/${listed.storeId}/products/${id}</loc>`);
    expect(res.text).not.toContain(hidden.storeId);
    // Cart, checkout and account pages are never in it.
    expect(res.text).not.toMatch(/\/(cart|checkout|account)<\/loc>/);
  });

  it("adds a shop's policies page once it has written one", async () => {
    await request(app).put(`/api/v1/stores/${listed.storeId}/policies/refund`).set("Authorization", `Bearer ${listed.token}`).send({ body: "Returns within 7 days." });
    seo.clearSitemapCache();
    expect((await request(app).get("/api/v1/seo/sitemap.xml")).text).toContain(`/store/${listed.storeId}/policies</loc>`);
  });
});

describe("link previews", () => {
  it("a product's card has its title, price, text and the shop's name, with every value escaped", async () => {
    const res = await request(app).get(`/api/v1/seo/preview?path=/store/${listed.storeId}/products/${listed.productIds[0]}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain('<meta property="og:type" content="product">');
    expect(res.text).toMatch(/<meta property="og:description" content="Rs\s?450\.00\. Hand-thrown clay cup/);
    expect(res.text).toContain("Clay cup &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; | SEO listed &quot;Chai&quot; &amp; &lt;Co&gt;");
    expect(res.text).not.toContain("<script>");
    expect(res.text).toContain(`<link rel="canonical" href="${env.storefrontUrl.replace(/\/+$/, "")}/store/${listed.storeId}/products/${listed.productIds[0]}">`);
  });

  it("a shop's card has the shop's name", async () => {
    const res = await request(app).get(`/api/v1/seo/preview?path=/store/${listed.storeId}`);
    expect(res.text).toContain('<meta property="og:title" content="SEO listed &quot;Chai&quot; &amp; &lt;Co&gt;">');
  });

  it("anything else gets ZYRO's own card, never an error", async () => {
    for (const path of ["/store/nosuchstore0000000", `/store/${listed.storeId}/products/ffffffffffffffffffffffff`, "/admin", "javascript:alert(1)", ""]) {
      const res = await request(app).get(`/api/v1/seo/preview?path=${encodeURIComponent(path)}`);
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/<title>(ZYRO: a free online shop with AI built in|SEO listed .*)<\/title>/);
      expect(res.text).not.toContain("javascript:");
    }
  });
});
