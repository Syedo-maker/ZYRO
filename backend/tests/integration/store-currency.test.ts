/**
 * The store's currency, end to end on real Postgres, MongoDB and Redis with a fake Stripe gateway:
 * chosen at sign-up (US dollars when left out, as before), shown and changed on the owner's Settings
 * page, locked after the first sale or while a shopper is paying, and the smallest online card
 * payment set per currency so Stripe never refuses a checkout at the last step.
 */
process.env.RATE_LIMIT_ENABLED = "false";

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let Product: typeof import("../../src/models/Product.model").Product;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };
const stripeSessions: { currency: string; totalCents?: number }[] = [];

async function api(method: string, path: string, opts: { token?: string; guest?: string; body?: unknown } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${path}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  if (opts.guest) req = req.set("X-Guest-Session-Id", opts.guest);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

async function merchant(tag: string, currency?: string) {
  const email = `verify-cur-${tag}-${suffix}@example.com`;
  const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `Verify ${tag}`, storeSlug: `verify-cur-${tag}-${suffix}`, ...(currency ? { currency } : {}) } });
  if (reg.status !== 201) throw new Error(`register ${tag}: ${reg.status} ${JSON.stringify(reg.json)}`);
  const storeId = (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id as string;
  created.tenantIds.push(storeId);
  created.userIds.push(reg.json.user.id);
  return { token: reg.json.accessToken as string, storeId };
}

const product = async (owner: { token: string; storeId: string }, title: string, price: number) =>
  (await api("POST", `/stores/${owner.storeId}/products`, { token: owner.token, body: { title, price, stock: 20, category: "kitchen" } })).json.id as string;

let pk: Awaited<ReturnType<typeof merchant>>;

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ Product } = await import("../../src/models/Product.model"));
  await (await import("../../src/lib/mongo")).connectMongo();
  const { getStripeGateway, setStripeGateway } = await import("../../src/lib/stripe");
  setStripeGateway({
    ...getStripeGateway(),
    async createCheckoutSession(params) {
      stripeSessions.push({ currency: params.currency });
      return { id: `cs_test_verify_cur_${suffix}_${stripeSessions.length}`, url: `https://checkout.stripe.test/pay/${stripeSessions.length}` };
    },
  });
  pk = await merchant("pk", "PKR");
}, 60_000);

afterAll(async () => {
  (await import("../../src/lib/stripe")).setStripeGateway(undefined);
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

describe("choosing the currency at sign-up", () => {
  it("a store created with PKR sells in rupees, and its public profile says so", async () => {
    expect((await api("GET", `/stores/${pk.storeId}`)).json.currency).toBe("PKR");
  });

  it("leaving the currency out still gives US dollars, so older sign-up forms keep working", async () => {
    const us = await merchant("us");
    expect((await api("GET", `/stores/${us.storeId}`)).json.currency).toBe("USD");
  });

  it.each(["JPY", "pkr", "RUPEES", ""])("a currency that is not on the list (%j) is refused with 400 and no store is made", async (currency) => {
    const res = await api("POST", "/auth/register", { body: { email: `verify-cur-bad-${suffix}@example.com`, password: "password123", storeName: "Bad", storeSlug: `verify-cur-bad-${suffix}`, currency } });
    expect(res.status).toBe(400);
    expect(await prismaUnscoped.tenant.count({ where: { slug: `verify-cur-bad-${suffix}` } })).toBe(0);
  });
});

describe("the owner's currency setting", () => {
  it("shows the current currency, that it can still be changed, and the choices with their names", async () => {
    const res = await api("GET", `/stores/${pk.storeId}/currency`, { token: pk.token });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ currency: "PKR", locked: false, reason: null });
    const codes = res.json.options.map((o: { code: string }) => o.code);
    expect(codes).toEqual(expect.arrayContaining(["PKR", "INR", "USD", "GBP", "EUR"]));
    expect(res.json.options.find((o: { code: string }) => o.code === "INR").name).toBe("Indian rupee");
  });

  it("before any sale the owner can switch, and the cart and checkout quote follow at once", async () => {
    const res = await api("PATCH", `/stores/${pk.storeId}/currency`, { token: pk.token, body: { currency: "INR" } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ currency: "INR", currencyLocked: false });
    expect((await api("GET", `/stores/${pk.storeId}/cart`, { guest: `guest-${suffix}-switchcart` })).json.currency).toBe("INR");
    expect((await api("PATCH", `/stores/${pk.storeId}/currency`, { token: pk.token, body: { currency: "PKR" } })).status).toBe(200);
  });

  it("a currency that is not on the list, or no body, is 400 and changes nothing", async () => {
    expect((await api("PATCH", `/stores/${pk.storeId}/currency`, { token: pk.token, body: { currency: "JPY" } })).status).toBe(400);
    expect((await api("PATCH", `/stores/${pk.storeId}/currency`, { token: pk.token })).status).toBe(400);
    expect((await api("GET", `/stores/${pk.storeId}`)).json.currency).toBe("PKR");
  });

  it("only the owner can see or change it: no token is 401, another store's owner is 403", async () => {
    const other = await merchant("other");
    expect((await api("GET", `/stores/${pk.storeId}/currency`)).status).toBe(401);
    expect((await api("PATCH", `/stores/${pk.storeId}/currency`, { body: { currency: "USD" } })).status).toBe(401);
    expect((await api("GET", `/stores/${pk.storeId}/currency`, { token: other.token })).status).toBe(403);
    expect((await api("PATCH", `/stores/${pk.storeId}/currency`, { token: other.token, body: { currency: "USD" } })).status).toBe(403);
    expect((await api("GET", `/stores/${pk.storeId}`)).json.currency).toBe("PKR");
  });

  it("staff cannot change it either (403)", async () => {
    const email = `verify-cur-staff-${suffix}@example.com`;
    await api("POST", `/stores/${pk.storeId}/staff`, { token: pk.token, body: { email, password: "password123", permissions: ["products_write", "pos_sell"] } });
    const login = await api("POST", "/auth/login", { body: { email, password: "password123" } });
    created.userIds.push(login.json.user.id);
    expect((await api("PATCH", `/stores/${pk.storeId}/currency`, { token: login.json.accessToken, body: { currency: "USD" } })).status).toBe(403);
  });
});

describe("the smallest online payment, per currency", () => {
  it("a Rs 150 order is stopped before the shopper reaches Stripe, saying the rupee minimum", async () => {
    const cheap = await product(pk, "Tea Bag Pack", 150);
    const guest = `guest-${suffix}-cheapcart`;
    await api("POST", `/stores/${pk.storeId}/cart/items`, { guest, body: { productId: cheap, quantity: 1 } });
    const before = stripeSessions.length;
    const res = await api("POST", `/stores/${pk.storeId}/checkout/session`, { guest, body: {} });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.json)).toMatch(/200\.00 PKR/);
    expect(stripeSessions.length).toBe(before);
  });

  it("a Rs 450 order goes to Stripe, charged in rupees", async () => {
    const cup = await product(pk, "Clay Chai Cup", 450);
    const guest = `guest-${suffix}-cupcart`;
    await api("POST", `/stores/${pk.storeId}/cart/items`, { guest, body: { productId: cup, quantity: 1 } });
    const res = await api("POST", `/stores/${pk.storeId}/checkout/session`, { guest, body: {} });
    expect(res.status).toBe(201);
    expect(stripeSessions[stripeSessions.length - 1].currency).toBe("PKR");
  });

  it("a dollar store keeps the 0.50 USD minimum: a $1 order goes through", async () => {
    const us = await merchant("us2");
    const pen = await product(us, "Pen", 1);
    const guest = `guest-${suffix}-pencart`;
    await api("POST", `/stores/${us.storeId}/cart/items`, { guest, body: { productId: pen, quantity: 1 } });
    expect((await api("POST", `/stores/${us.storeId}/checkout/session`, { guest, body: {} })).status).toBe(201);
  });
});

describe("the currency locks once money is involved", () => {
  it("while a shopper is part-way through paying, the currency cannot change (409, and says why)", async () => {
    // The Rs 450 checkout above is still open.
    const res = await api("PATCH", `/stores/${pk.storeId}/currency`, { token: pk.token, body: { currency: "USD" } });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.json)).toMatch(/paying for an order right now/);
    const view = await api("GET", `/stores/${pk.storeId}/currency`, { token: pk.token });
    expect(view.json).toMatchObject({ currency: "PKR", locked: true });
  });

  it("after the first sale (here at the register) it is locked for good, and says why", async () => {
    const shop = await merchant("pos", "GBP");
    const mug = await product(shop, "Mug", 8);
    await api("POST", `/stores/${shop.storeId}/pos/shift/open`, { token: shop.token, body: { openingFloat: 50 } });
    const sale = await api("POST", `/stores/${shop.storeId}/pos/sales`, { token: shop.token, body: { items: [{ productId: mug, quantity: 1 }], payments: [{ method: "cash", amount: 8 }] } });
    expect(sale.status).toBe(201);
    expect(sale.json.currency).toBe("GBP");

    const res = await api("PATCH", `/stores/${shop.storeId}/currency`, { token: shop.token, body: { currency: "USD" } });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.json)).toMatch(/after the store's first sale/);
    expect((await api("GET", `/stores/${shop.storeId}/currency`, { token: shop.token })).json).toMatchObject({ currency: "GBP", locked: true });
    expect((await api("GET", `/stores/${shop.storeId}`)).json.currency).toBe("GBP");
  });

  it("setting the currency the store already has is harmless even when locked", async () => {
    const res = await api("PATCH", `/stores/${pk.storeId}/currency`, { token: pk.token, body: { currency: "PKR" } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ currency: "PKR", currencyLocked: true });
  });
});
