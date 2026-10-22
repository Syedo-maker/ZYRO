/**
 * The three prices (the supervisor's product-listing change): the owner sets the actual price (the
 * MRP) and optionally a discounted price; the sale price is computed from them and is what the cart,
 * the register and every order charge. An order keeps the price it was sold at.
 */
process.env.RATE_LIMIT_ENABLED = "false";

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let Product: typeof import("../../src/models/Product.model").Product;
let Category: typeof import("../../src/models/Category.model").Category;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };
let token = "";
let storeId = "";
let categoryId = "";

async function api(method: string, p: string, opts: { token?: string; guest?: string; body?: unknown } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${p}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  if (opts.guest) req = req.set("X-Guest-Session-Id", opts.guest);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

const product = (body: Record<string, unknown>) =>
  api("POST", `/stores/${storeId}/products`, { token, body: { title: "Kettle", stock: 10, categoryId, ...body } });

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ Product } = await import("../../src/models/Product.model"));
  ({ Category } = await import("../../src/models/Category.model"));
  await (await import("../../src/lib/mongo")).connectMongo();
  const reg = await api("POST", "/auth/register", {
    body: { email: `verify-price-${suffix}@example.com`, password: "password123", storeName: "Prices", storeSlug: `verify-price-${suffix}`, currency: "PKR" },
  });
  expect(reg.status).toBe(201);
  token = reg.json.accessToken;
  storeId = (await api("GET", "/users/me/stores", { token })).json[0].id;
  created.tenantIds.push(storeId);
  created.userIds.push(reg.json.user.id);
  await prismaUnscoped.tenant.update({ where: { id: storeId }, data: { taxRate: 0 } });
  categoryId = (await api("POST", `/stores/${storeId}/categories`, { token, body: { name: "Kitchen" } })).json.id;
}, 120_000);

afterAll(async () => {
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  await Category.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

describe("the price rules", () => {
  it.each([
    ["no price at all", {}, /price is required/i],
    ["an actual price of zero", { actualPrice: 0 }, /more than zero/],
    ["a negative actual price", { actualPrice: -5 }, /more than zero/],
    ["a discounted price of zero", { actualPrice: 1000, discountPrice: 0 }, /more than zero/],
    ["a negative discounted price", { actualPrice: 1000, discountPrice: -1 }, /more than zero/],
    ["a discounted price above the actual price", { actualPrice: 1000, discountPrice: 1200 }, /cannot be more than the actual price/],
  ])("refuses %s", async (_label, body, message) => {
    const res = await product(body);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.json)).toMatch(message);
  });

  it("accepts a discounted price equal to the actual price, which shows no badge", async () => {
    const res = await product({ actualPrice: 500, discountPrice: 500 });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ actualPrice: 500, discountPrice: 500, salePrice: 500, discountPercent: null });
  });
});

describe("the sale price", () => {
  it("is the discounted price when there is one, with the percent off", async () => {
    const res = await product({ actualPrice: 1000, discountPrice: 800 });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ actualPrice: 1000, discountPrice: 800, salePrice: 800, discountPercent: 20, price: 800 });
  });

  it("is the actual price when there is no discount", async () => {
    const res = await product({ actualPrice: 1000 });
    expect(res.json).toMatchObject({ actualPrice: 1000, discountPrice: null, salePrice: 1000, discountPercent: null });
  });

  it("an older caller's single price is read as the actual price", async () => {
    const res = await product({ price: 750 });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ actualPrice: 750, salePrice: 750, discountPrice: null });
  });

  it("an edit can add a discount and later take it away", async () => {
    const id = (await product({ actualPrice: 2000 })).json.id;
    const base = { title: "Kettle", stock: 10, categoryId, actualPrice: 2000 };
    const discounted = await api("PUT", `/stores/${storeId}/products/${id}`, { token, body: { ...base, discountPrice: 1500 } });
    expect(discounted.json).toMatchObject({ salePrice: 1500, discountPercent: 25 });
    const full = await api("PUT", `/stores/${storeId}/products/${id}`, { token, body: { ...base, discountPrice: null } });
    expect(full.json).toMatchObject({ discountPrice: null, salePrice: 2000, discountPercent: null });
    const stored = await Product.findOne({ _id: id, storeId }).lean();
    expect(stored!.discountPrice).toBeUndefined();
    expect(stored!.price).toBeUndefined();
  });

  it("a product stored before the three prices still sells at its old price", async () => {
    const legacy = await Product.create({ storeId, title: "Old Teapot", category: "Kitchen", categoryId, price: 450 } as never);
    const res = await api("GET", `/stores/${storeId}/products/${legacy._id}`);
    expect(res.json).toMatchObject({ actualPrice: 450, salePrice: 450, price: 450, discountPrice: null });
    // Sorting and the price filter read the stored sale price, which only the migration gives it.
    await Product.deleteOne({ _id: legacy._id, storeId });
  });

  it("sorting and the price filter use what customers pay", async () => {
    const list = (q: string) => api("GET", `/stores/${storeId}/products?${q}`).then((r) => r.json.data as { title: string; salePrice: number }[]);
    await product({ title: "Sort Cheap", actualPrice: 9000, discountPrice: 100 });
    await product({ title: "Sort Dear", actualPrice: 8000 });
    const asc = (await list("sort=price_asc&limit=50")).map((p) => p.salePrice);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    const cheap = await list("maxPrice=200&limit=50");
    expect(cheap.map((p) => p.title)).toContain("Sort Cheap");
    expect(cheap.map((p) => p.title)).not.toContain("Sort Dear");
  });
});

describe("what is charged", () => {
  let id = "";

  beforeAll(async () => {
    id = (await product({ title: "Toaster", actualPrice: 1000, discountPrice: 900, stock: 20 })).json.id;
  });

  it("the cart charges the sale price, and follows a price edit at once", async () => {
    const guest = `guest-${suffix}-prices01`;
    const cart = await api("POST", `/stores/${storeId}/cart/items`, { guest, body: { productId: id, quantity: 2 } });
    expect(cart.json.subtotal).toBe(1800);
    await api("PUT", `/stores/${storeId}/products/${id}`, { token, body: { title: "Toaster", stock: 20, categoryId, actualPrice: 1000, discountPrice: 850 } });
    expect((await api("GET", `/stores/${storeId}/cart`, { guest })).json.subtotal).toBe(1700);
  });

  it("the register charges the sale price, and the sale keeps it after the price changes", async () => {
    expect((await api("POST", `/stores/${storeId}/pos/shift/open`, { token, body: { openingFloat: 0 } })).status).toBe(201);
    const sold = await api("POST", `/stores/${storeId}/pos/sales`, { token, body: { items: [{ productId: id, quantity: 1 }], payments: [{ method: "card", amount: 850 }] } });
    expect(sold.status).toBe(201);
    expect(sold.json.items[0].unitPrice).toBe(850);

    await api("PUT", `/stores/${storeId}/products/${id}`, { token, body: { title: "Toaster", stock: 19, categoryId, actualPrice: 1200 } });
    const later = await api("GET", `/stores/${storeId}/pos/sales/${sold.json.id}`, { token });
    expect(later.json.items[0].unitPrice).toBe(850);
    expect(later.json.total).toBe(850);
  });
});
