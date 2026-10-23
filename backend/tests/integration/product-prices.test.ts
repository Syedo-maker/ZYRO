/**
 * The three prices (the supervisor's product-listing change, discount modes 2026-10-23): the owner
 * sets the actual price (the MRP) and optionally a discount, as an amount (Rs off) or a percentage;
 * the selling price is MRP minus the discount and is what the cart, the register and every order
 * charge. Older products are converted by the migration without changing what customers pay. An
 * order line keeps the price paid, the MRP and the discount at the time of sale, at the register and
 * online alike, and the database refuses a line where they do not add up.
 */
process.env.RATE_LIMIT_ENABLED = "false";

import request from "supertest";
import type { Express } from "express";
import { Types } from "mongoose";

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

const edit = (id: string, body: Record<string, unknown>) => api("PUT", `/stores/${storeId}/products/${id}`, { token, body: { title: "Kettle", stock: 10, categoryId, ...body } });

describe("the price rules", () => {
  it.each([
    ["no price at all", {}, /price is required/i],
    ["an actual price of zero", { actualPrice: 0 }, /more than zero/],
    ["a negative actual price", { actualPrice: -5 }, /more than zero/],
    ["a negative discount", { actualPrice: 1000, discountType: "amount", discountValue: -1 }, /cannot be below zero/],
    ["an amount off as large as the MRP", { actualPrice: 1000, discountType: "amount", discountValue: 1000 }, /must be less than the price \(MRP\)/],
    ["100% off", { actualPrice: 1000, discountType: "percent", discountValue: 100 }, /less than 100%/],
    ["a selling price that rounds to zero", { actualPrice: 1000, discountType: "percent", discountValue: 99.999 }, /selling price must stay above zero/],
    ["a discount value with no type", { actualPrice: 1000, discountValue: 200 }, /amount or a percentage/],
    ["an older caller's discounted price above the MRP", { actualPrice: 1000, discountPrice: 1200 }, /cannot be more than the actual price/],
  ])("refuses %s", async (_label, body, message) => {
    const res = await product(body);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.json)).toMatch(message);
  });

  it("a discount of zero is no discount, and shows no badge", async () => {
    const res = await product({ actualPrice: 500, discountType: "percent", discountValue: 0 });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ actualPrice: 500, discountType: null, discountValue: null, discountAmount: 0, salePrice: 500, discountPercent: null });
  });
});

describe("the selling price", () => {
  it("an amount off: MRP minus the amount, stored with its type", async () => {
    const res = await product({ actualPrice: 1000, discountType: "amount", discountValue: 200 });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ actualPrice: 1000, discountType: "amount", discountValue: 200, discountAmount: 200, salePrice: 800, discountPercent: 20, discountPrice: 800, price: 800 });
    const stored = await Product.findOne({ _id: res.json.id, storeId }).lean();
    expect({ type: stored!.discountType, value: Number(stored!.discountValue!.toString()), sale: Number(stored!.salePrice!.toString()) }).toEqual({ type: "amount", value: 200, sale: 800 });
  });

  it("a percentage off: MRP minus the percentage, rounded to the hundredth", async () => {
    const res = await product({ actualPrice: 999, discountType: "percent", discountValue: 33.33 });
    expect(res.json).toMatchObject({ actualPrice: 999, discountType: "percent", discountValue: 33.33, discountAmount: 332.97, salePrice: 666.03, discountPercent: 33 });
  });

  it("is the MRP when there is no discount", async () => {
    const res = await product({ actualPrice: 1000 });
    expect(res.json).toMatchObject({ actualPrice: 1000, discountType: null, discountValue: null, discountAmount: 0, discountPrice: null, salePrice: 1000, discountPercent: null });
  });

  it("an older caller's single price is read as the MRP", async () => {
    const res = await product({ price: 750 });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ actualPrice: 750, salePrice: 750, discountType: null });
  });

  it("an older caller's discounted price is stored as an amount off", async () => {
    const res = await product({ actualPrice: 1000, discountPrice: 850 });
    expect(res.json).toMatchObject({ discountType: "amount", discountValue: 150, salePrice: 850 });
  });

  it("an edit can add a discount, switch it from Rs to %, and take it away", async () => {
    const id = (await product({ actualPrice: 2000 })).json.id;
    expect((await edit(id, { actualPrice: 2000, discountType: "amount", discountValue: 500 })).json).toMatchObject({ discountType: "amount", discountValue: 500, salePrice: 1500 });
    expect((await edit(id, { actualPrice: 2000, discountType: "percent", discountValue: 25 })).json).toMatchObject({ discountType: "percent", discountValue: 25, salePrice: 1500 });
    const full = await edit(id, { actualPrice: 2000, discountType: null, discountValue: null });
    expect(full.json).toMatchObject({ discountType: null, discountValue: null, salePrice: 2000, discountPercent: null });
    const stored = await Product.findOne({ _id: id, storeId }).lean();
    expect(stored!.discountType).toBeUndefined();
    expect(stored!.discountValue).toBeUndefined();
    expect(stored!.discountPrice).toBeUndefined();
    expect(stored!.price).toBeUndefined();
  });

  it("a percentage discount follows a new MRP", async () => {
    const id = (await product({ actualPrice: 1000, discountType: "percent", discountValue: 10 })).json.id;
    expect((await edit(id, { actualPrice: 2000, discountType: "percent", discountValue: 10 })).json).toMatchObject({ salePrice: 1800, discountAmount: 200 });
  });

  it("a product stored before the three prices still sells at its old price", async () => {
    // Only the single `price` field, as every product had before the three prices.
    const legacy = await new Product({ storeId, title: "Old Teapot", category: "Kitchen", categoryId, price: 450 }).save();
    try {
      const res = await api("GET", `/stores/${storeId}/products/${legacy._id}`);
      expect(res.json).toMatchObject({ actualPrice: 450, salePrice: 450, price: 450, discountType: null, discountPercent: null });
      // And it can still be bought, at that price (its stock lives in inventory, as it always did).
      expect((await api("PATCH", `/stores/${storeId}/products/${legacy._id}/stock`, { token, body: { stock: 5 } })).status).toBe(200);
      const cart = await api("POST", `/stores/${storeId}/cart/items`, { guest: `guest-${suffix}-legacy01`, body: { productId: legacy._id.toString(), quantity: 2 } });
      expect(cart.status).toBe(200);
      expect(cart.json.subtotal).toBe(900);
    } finally {
      // Sorting and the price filter read the stored sale price, which only the migration gives it.
      await Product.deleteOne({ _id: legacy._id, storeId });
    }
  });

  it("sorting and the price filter use what customers pay", async () => {
    const list = (q: string) => api("GET", `/stores/${storeId}/products?${q}`).then((r) => r.json.data as { title: string; salePrice: number }[]);
    await product({ title: "Sort Cheap", actualPrice: 9000, discountType: "amount", discountValue: 8900 });
    await product({ title: "Sort Dear", actualPrice: 8000 });
    const asc = (await list("sort=price_asc&limit=50")).map((p) => p.salePrice);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    const cheap = await list("maxPrice=200&limit=50");
    expect(cheap.map((p) => p.title)).toContain("Sort Cheap");
    expect(cheap.map((p) => p.title)).not.toContain("Sort Dear");
  });
});

describe("the migration of older products", () => {
  it("a single price becomes the MRP and an old discounted price an amount off; customers pay the same; a second run changes nothing", async () => {
    const { migrateProductPrices } = await import("../../src/modules/products/product.migration");
    const raw = Product.collection;
    const dec = (n: number) => Types.Decimal128.fromString(n.toFixed(2));
    const base = { storeId, category: "Kitchen", categoryId: new Types.ObjectId(categoryId), images: [], tags: [], taxable: true, description: "" };
    // Written straight to the collection, as products were stored before each change.
    const { insertedIds } = await raw.insertMany([
      { ...base, title: "Single Price", price: dec(450) },
      { ...base, title: "Old Discount", actualPrice: dec(1000), discountPrice: dec(850), salePrice: dec(850) },
      { ...base, title: "Old No Discount", actualPrice: dec(500), discountPrice: dec(500), salePrice: dec(500) },
    ]);
    const ids = Object.values(insertedIds);
    try {
      const before = await Promise.all(ids.map((id) => api("GET", `/stores/${storeId}/products/${id}`).then((r) => r.json.salePrice)));
      expect(before).toEqual([450, 850, 500]);

      expect(await migrateProductPrices({ apply: false, storeIds: [storeId] })).toEqual({ singlePrice: 1, singlePriceAtZero: 0, discountedPrice: 2, leftovers: 0 });
      await migrateProductPrices({ apply: true, storeIds: [storeId] });

      const after = await raw.find({ _id: { $in: ids } }).sort({ title: 1 }).toArray();
      const shape = (p: (typeof after)[number]) => ({
        title: p.title,
        actualPrice: Number(p.actualPrice.toString()),
        salePrice: Number(p.salePrice.toString()),
        discountType: p.discountType ?? null,
        discountValue: p.discountValue === undefined ? null : Number(p.discountValue.toString()),
        old: "price" in p || "discountPrice" in p,
      });
      expect(after.map(shape)).toEqual([
        { title: "Old Discount", actualPrice: 1000, salePrice: 850, discountType: "amount", discountValue: 150, old: false },
        { title: "Old No Discount", actualPrice: 500, salePrice: 500, discountType: null, discountValue: null, old: false },
        { title: "Single Price", actualPrice: 450, salePrice: 450, discountType: null, discountValue: null, old: false },
      ]);
      const again = await Promise.all(ids.map((id) => api("GET", `/stores/${storeId}/products/${id}`).then((r) => r.json.salePrice)));
      expect(again).toEqual(before);
      expect(await migrateProductPrices({ apply: true, storeIds: [storeId] })).toEqual({ singlePrice: 0, singlePriceAtZero: 0, discountedPrice: 0, leftovers: 0 });
    } finally {
      await raw.deleteMany({ _id: { $in: ids }, storeId });
    }
  });
});

describe("what is charged, and what an order keeps", () => {
  let id = "";

  beforeAll(async () => {
    id = (await product({ title: "Toaster", actualPrice: 1000, discountType: "amount", discountValue: 100, stock: 20 })).json.id;
  });

  it("the cart charges the selling price, and follows a price edit at once", async () => {
    const guest = `guest-${suffix}-prices01`;
    const cart = await api("POST", `/stores/${storeId}/cart/items`, { guest, body: { productId: id, quantity: 2 } });
    expect(cart.json.subtotal).toBe(1800);
    await edit(id, { title: "Toaster", stock: 20, actualPrice: 1000, discountType: "percent", discountValue: 15 });
    expect((await api("GET", `/stores/${storeId}/cart`, { guest })).json.subtotal).toBe(1700);
  });

  it("the register charges the selling price, and the sale keeps it, the MRP and the discount after the price changes", async () => {
    expect((await api("POST", `/stores/${storeId}/pos/shift/open`, { token, body: { openingFloat: 0 } })).status).toBe(201);
    const sold = await api("POST", `/stores/${storeId}/pos/sales`, { token, body: { items: [{ productId: id, quantity: 1 }], payments: [{ method: "card", amount: 850 }] } });
    expect(sold.status).toBe(201);
    expect(sold.json.items[0]).toMatchObject({ unitPrice: 850, unitMrp: 1000, unitDiscount: 150 });
    expect(sold.json.savings).toBe(150);

    await edit(id, { title: "Toaster", stock: 19, actualPrice: 1200 });
    const later = await api("GET", `/stores/${storeId}/pos/sales/${sold.json.id}`, { token });
    expect(later.json.items[0]).toMatchObject({ unitPrice: 850, unitMrp: 1000, unitDiscount: 150 });
    expect(later.json.total).toBe(850);
    expect(later.json.savings).toBe(150);
  });

  it("an online order keeps the price paid, the MRP and the discount per line, whatever happens to the product later", async () => {
    const lamp = (await product({ title: "Desk Lamp", actualPrice: 2000, discountType: "amount", discountValue: 400, stock: 5 })).json.id;
    await api("PATCH", `/stores/${storeId}/payments/settings`, { token, body: { codEnabled: true } });
    const guest = `guest-${suffix}-prices02`;
    expect((await api("POST", `/stores/${storeId}/cart/items`, { guest, body: { productId: lamp, quantity: 2 } })).json.subtotal).toBe(3200);
    const placed = await api("POST", `/stores/${storeId}/payments/orders`, {
      guest,
      body: { method: "cod", name: "Ayesha Khan", phone: "03001234567", email: `verify-price-shopper-${suffix}@example.com`, address: { line1: "12 Mall Road", city: "Lahore", country: "PK" } },
    });
    expect(placed.status).toBe(201);
    // The shopper's confirmation: "you saved Rs 800", 400 on each of the two.
    expect(placed.json.savings).toBe(800);

    // The owner changes the discount to a percentage, then ends it and raises the MRP.
    await edit(lamp, { title: "Desk Lamp", stock: 3, actualPrice: 2000, discountType: "percent", discountValue: 50 });
    await edit(lamp, { title: "Desk Lamp", stock: 3, actualPrice: 2500 });
    const order = await prismaUnscoped.order.findUnique({ where: { id: placed.json.orderId }, include: { items: true } });
    expect(order!.items).toHaveLength(1);
    const line = order!.items[0];
    expect({ paid: line.unitPrice.toString(), mrp: line.unitMrpSnapshot.toString(), discount: line.unitDiscountSnapshot.toString(), total: line.lineTotal.toString() }).toEqual({ paid: "1600", mrp: "2000", discount: "400", total: "3200" });
    expect(Number(order!.subtotal.toString())).toBe(3200);
    const view = await api("GET", `/stores/${storeId}/orders/${placed.json.orderId}`, { token });
    expect(view.status).toBe(200);
    expect(view.json.items[0]).toMatchObject({ unitPrice: 1600, unitMrp: 2000, unitDiscount: 400 });
    expect(view.json.savings).toBe(800);
  });

  it("the database refuses an order line whose MRP, discount and price paid do not add up", async () => {
    const line = await prismaUnscoped.orderItem.findFirstOrThrow({ where: { order: { tenantId: storeId } } });
    await expect(prismaUnscoped.orderItem.update({ where: { id: line.id }, data: { unitDiscountSnapshot: "1.00" } })).rejects.toThrow(/OrderItem_price_snapshot_adds_up/);
    await expect(prismaUnscoped.orderItem.update({ where: { id: line.id }, data: { unitMrpSnapshot: "1.00" } })).rejects.toThrow(/OrderItem_price_snapshot_adds_up/);
  });
});
