/**
 * Data lifecycle (modules/privacy/dataLifecycle.service.ts): a store's full export, a person's
 * export and erasure, and deleting a store, without touching any other store.
 */
process.env.RATE_LIMIT_ENABLED = "false";

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let Product: typeof import("../../src/models/Product.model").Product;
let ProductReview: typeof import("../../src/models/ProductReview.model").ProductReview;
let svc: typeof import("../../src/modules/privacy/dataLifecycle.service");
let getRedis: typeof import("../../src/lib/redis").getRedis;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };
const shopperEmail = `verify-life-shopper-${suffix}@example.com`;

async function api(method: string, path: string, opts: { token?: string; guest?: string; body?: unknown } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${path}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  if (opts.guest) req = req.set("X-Guest-Session-Id", opts.guest);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

async function store(tag: string) {
  const reg = await api("POST", "/auth/register", { body: { email: `verify-life-${tag}-${suffix}@example.com`, password: "password123", storeName: `Verify life ${tag}`, storeSlug: `verify-life-${tag}-${suffix}`, currency: "PKR" } });
  const storeId = (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id as string;
  created.tenantIds.push(storeId);
  created.userIds.push(reg.json.user.id);
  await api("PATCH", `/stores/${storeId}/payments/settings`, { token: reg.json.accessToken, body: { codEnabled: true } });
  const product = (await api("POST", `/stores/${storeId}/products`, { token: reg.json.accessToken, body: { title: `Life cup ${tag}`, price: 400, stock: 10, category: "kitchen" } })).json.id as string;
  return { token: reg.json.accessToken as string, storeId, product };
}

let A: Awaited<ReturnType<typeof store>>;
let B: Awaited<ReturnType<typeof store>>;
let shopper: { token: string; userId: string };

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ Product } = await import("../../src/models/Product.model"));
  ({ ProductReview } = await import("../../src/models/ProductReview.model"));
  ({ getRedis } = await import("../../src/lib/redis"));
  svc = await import("../../src/modules/privacy/dataLifecycle.service");
  await (await import("../../src/lib/mongo")).connectMongo();
  A = await store("a");
  B = await store("b");
  const c = await api("POST", "/auth/register-customer", { body: { email: shopperEmail, password: "password123", name: "Ayesha Khan" } });
  shopper = { token: c.json.accessToken, userId: c.json.user.id };
  created.userIds.push(shopper.userId);
  // The signed-in shopper buys from store A (cash on delivery), and reviews the cup.
  await api("POST", `/stores/${A.storeId}/cart/items`, { token: shopper.token, body: { productId: A.product, quantity: 1 } });
  const placed = await api("POST", `/stores/${A.storeId}/payments/orders`, { token: shopper.token, body: { name: "Ayesha Khan", phone: "03001234567", email: shopperEmail, address: { line1: "12 Mall Road", city: "Lahore", country: "PK" }, method: "cod" } });
  expect(placed.status).toBe(201);
  await ProductReview.create({ storeId: A.storeId, productId: A.product, customerId: shopper.userId, authorName: "Ayesha K.", rating: 5, comment: "Lovely cup" });
}, 120_000);

afterAll(async () => {
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  await ProductReview.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

it("a store's export has its orders, catalogue and customers, and no password or token hashes", async () => {
  const data = await svc.exportStore(A.storeId);
  expect(data.orders).toHaveLength(1);
  expect(data.catalogue.products).toHaveLength(1);
  expect(data.customers.map((c) => c.email)).toContain(shopperEmail);
  expect(data.reviews).toHaveLength(1);
  const text = JSON.stringify(data);
  expect(text).not.toMatch(/passwordHash|tokenHash|\$2[aby]\$/);
  expect(text).not.toContain(B.storeId);
});

it("a person's export finds their account, orders and reviews", async () => {
  const data = await svc.exportCustomer(shopperEmail);
  expect(data.account?.id).toBe(shopper.userId);
  expect(data.orders).toHaveLength(1);
  expect(data.reviews).toHaveLength(1);
  expect(JSON.stringify(data)).not.toMatch(/passwordHash|tokenHash/);
});

it("erasing a person removes their personal data and keeps the store's sales record, anonymised", async () => {
  const result = await svc.eraseCustomer(shopperEmail);
  expect(result).toMatchObject({ ordersAnonymised: 1, reviews: 1, account: "deleted" });
  const order = await prismaUnscoped.order.findFirst({ where: { tenantId: A.storeId } });
  expect(order?.total.toString()).toBe("400");
  expect(order?.guestEmail).toBeNull();
  expect(order?.shippingName).toBe("Erased on request");
  expect(order?.shippingAddress).toEqual({ country: "PK", erased: true });
  const customers = await prismaUnscoped.customer.findMany({ where: { tenantId: A.storeId } });
  expect(customers.every((c) => c.email === null && c.name === null && c.phone === null)).toBe(true);
  expect(await prismaUnscoped.user.count({ where: { id: shopper.userId } })).toBe(0);
  expect(await ProductReview.countDocuments({ storeId: A.storeId, customerId: shopper.userId })).toBe(0);
  expect(JSON.stringify(await svc.exportCustomer(shopperEmail))).not.toContain("Ayesha");
});

it("deleting a store removes everything it had, and leaves the other store as it was", async () => {
  await api("POST", `/stores/${A.storeId}/cart/items`, { guest: `guest-life-${suffix}-0001`, body: { productId: A.product, quantity: 1 } });
  expect((await getRedis().keys(`cart:${A.storeId}:*`)).length).toBeGreaterThan(0);
  const result = await svc.deleteStore(A.storeId);
  expect(result.mongo.products).toBe(1);
  expect(await prismaUnscoped.tenant.count({ where: { id: A.storeId } })).toBe(0);
  expect(await prismaUnscoped.order.count({ where: { tenantId: A.storeId } })).toBe(0);
  expect(await Product.countDocuments({ storeId: A.storeId })).toBe(0);
  expect((await getRedis().keys(`cart:${A.storeId}:*`)).length).toBe(0);
  // Store B is untouched.
  expect(await prismaUnscoped.tenant.count({ where: { id: B.storeId } })).toBe(1);
  expect(await Product.countDocuments({ storeId: B.storeId })).toBe(1);
  expect((await api("GET", `/stores/${B.storeId}/products`)).json.data).toHaveLength(1);
});
