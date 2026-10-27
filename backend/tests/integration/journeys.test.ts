/**
 * Whole-system journeys (Production_Readiness.md, Phase 4): every kind of person who uses ZYRO, one
 * after another, in the same store, so the workflows are tested against each other and not only one
 * at a time. After each step the cross-module invariants are checked: stock agrees with what was sold
 * and restocked, every order adds up, the dashboard agrees with the orders, and nothing leaks to
 * another store.
 *
 *   owner           sets the shop up: payments, products, staff
 *   guest shopper   buys by cash on delivery, without an account
 *   signed-in shopper  buys by bank transfer and sends in the receipt
 *   staff (orders)  checks the receipt and records the delivery cash
 *   cashier         sells in the shop on the register, opens and closes the drawer
 *   owner           reads the dashboard, refunds an order
 *   another owner   sees none of it
 *   platform admin  sees the store in the platform totals, and no customer data
 *
 * Every response along the way is also checked against openapi.yaml (tests/helpers/conformance.ts).
 */
process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_QUEUE_NAME = `ai-generate-verify-journeys-${Date.now().toString(36)}`;
process.env.AI_CACHE_SECONDS = "0";
process.env.COD_PHONE_PEPPER = `test-pepper-journeys-${Date.now()}`;

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let Product: typeof import("../../src/models/Product.model").Product;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[], keys: [] as string[] };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function api(method: string, p: string, opts: { token?: string; guest?: string; body?: unknown } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${p}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  if (opts.guest) req = req.set("X-Guest-Session-Id", opts.guest);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

async function owner(tag: string) {
  const email = `verify-journey-${tag}-${suffix}@example.com`;
  const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `Journey ${tag}`, storeSlug: `verify-journey-${tag}-${suffix}`, currency: "PKR" } });
  expect(reg.status).toBe(201);
  const storeId = (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id as string;
  created.tenantIds.push(storeId);
  created.userIds.push(reg.json.user.id);
  return { token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string, slug: `verify-journey-${tag}-${suffix}` };
}

async function staff(o: { token: string; storeId: string }, tag: string, permissions: string[]) {
  const email = `verify-journey-${tag}-${suffix}@example.com`;
  const made = await api("POST", `/stores/${o.storeId}/staff`, { token: o.token, body: { email, name: tag, password: "staff-pass-123", permissions } });
  expect(made.status).toBe(201);
  const login = await api("POST", "/auth/login", { body: { email, password: "staff-pass-123" } });
  created.userIds.push(login.json.user.id);
  return { token: login.json.accessToken as string };
}

const shopperDetails = (name: string, phone: string) => ({
  name,
  phone,
  email: `verify-journey-buyer-${phone}-${suffix}@example.com`,
  address: { line1: "12 Mall Road", city: "Lahore", country: "PK" },
});

let A: Awaited<ReturnType<typeof owner>>;
let B: Awaited<ReturnType<typeof owner>>;
let clerk: { token: string };
let cashier: { token: string };
let shopper: { token: string; userId: string };
const product = { cup: "", shawl: "" };
const START = { cup: 10, shawl: 4 };
/** What each order totalled, by id, as the API reported it at the time. */
const totals = new Map<string, number>();
let codOrder = "";
let transferOrder = "";
let posSale = "";

const stockOf = async (id: string) => (await api("GET", `/stores/${A.storeId}/products/${id}`)).json.stock as number;
const orderOf = async (id: string) => (await api("GET", `/stores/${A.storeId}/orders/${id}`, { token: A.token })).json;
const round2 = (n: number) => Math.round(n * 100) / 100;

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ Product } = await import("../../src/models/Product.model"));
  await (await import("../../src/lib/mongo")).connectMongo();
  // The AI reads receipts. Faked here so the journey is repeatable: it "reads" the amount the
  // shopper paid, which is what a real, matching receipt would show.
  (await import("../../src/lib/aiProvider")).setAiProvider({
    async generate(p) {
      const amount = Number(/"declared":(\d+(?:\.\d+)?)/.exec(p.prompt)?.[1] ?? 1200);
      return { text: JSON.stringify({ readable: true, amount, currency: "PKR", date: new Date().toISOString().slice(0, 10), reference: `TRX-${suffix}`, bank: "Test Bank", sender: "Aisha Khan", note: null }), model: p.model, inputTokens: 50, outputTokens: 30 };
    },
  });
  (await import("../../src/lib/aiQueue")).startAiWorker();
}, 240_000);

afterAll(async () => {
  const storage = (await import("../../src/lib/storage")).getStorage();
  for (const t of created.tenantIds) await storage.removeStore(t);
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

/** The invariant behind every step: what is on the shelf is what was stocked, less what is sold and not returned. */
async function expectStock(cupSold: number, shawlSold: number) {
  expect(await stockOf(product.cup)).toBe(START.cup - cupSold);
  expect(await stockOf(product.shawl)).toBe(START.shawl - shawlSold);
}

/** Every order adds up: items, less discount, plus tax and shipping, is the total charged. */
async function expectOrderAddsUp(id: string) {
  const o = await orderOf(id);
  const itemSum = round2(o.items.reduce((s: number, i: { unitPrice: number; quantity: number }) => s + i.unitPrice * i.quantity, 0));
  expect(round2(o.subtotal)).toBe(itemSum);
  expect(round2(o.subtotal - (o.discountAmount ?? 0) + (o.taxAmount ?? 0) + (o.shippingAmount ?? 0))).toBe(round2(o.total));
  return o;
}

describe("a day in one shop, from setup to platform totals", () => {
  it("owner: sets up payments, two products and two staff", async () => {
    A = await owner("a");
    B = await owner("b");
    const settings = await api("PATCH", `/stores/${A.storeId}/payments/settings`, {
      token: A.token,
      body: { codEnabled: true, bankTransferEnabled: true, bankAccountName: "Journey A", bankAccountNumber: "PK00JOURNEY0001", bankName: "Test Bank" },
    });
    expect(settings.status).toBe(200);
    product.cup = (await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "Clay Chai Cup", price: 450, stock: START.cup, category: "kitchen" } })).json.id;
    product.shawl = (await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "Pashmina Shawl", price: 1200, stock: START.shawl, category: "clothing" } })).json.id;
    expect(product.cup && product.shawl).toBeTruthy();
    clerk = await staff(A, "clerk", ["orders_write"]);
    cashier = await staff(A, "cashier", ["pos_sell"]);
    await expectStock(0, 0);
  });

  it("guest shopper: buys two cups by cash on delivery, without an account", async () => {
    const guest = `guest-journey-${suffix}`;
    expect((await api("POST", `/stores/${A.storeId}/cart/items`, { guest, body: { productId: product.cup, quantity: 2 } })).status).toBe(200);
    const placed = await api("POST", `/stores/${A.storeId}/payments/orders`, { guest, body: { ...shopperDetails("Bilal Ahmed", "03001112222"), method: "cod" } });
    expect(placed.status).toBe(201);
    codOrder = placed.json.orderId;
    const o = await expectOrderAddsUp(codOrder);
    totals.set(codOrder, o.total);
    expect(o.status).toBe("pending");
    await expectStock(2, 0);
  });

  it("signed-in shopper: buys the shawl by bank transfer and sends in the receipt", async () => {
    const reg = await api("POST", "/auth/register-customer", { body: { email: `verify-journey-shopper-${suffix}@example.com`, password: "password123", name: "Aisha Khan" } });
    expect(reg.status).toBe(201);
    shopper = { token: reg.json.accessToken, userId: reg.json.user.id };
    created.userIds.push(shopper.userId);

    expect((await api("POST", `/stores/${A.storeId}/cart/items`, { token: shopper.token, body: { productId: product.shawl, quantity: 1 } })).status).toBe(200);
    const placed = await api("POST", `/stores/${A.storeId}/payments/orders`, { token: shopper.token, body: { ...shopperDetails("Aisha Khan", "03003334444"), method: "bank_transfer" } });
    expect(placed.status).toBe(201);
    transferOrder = placed.json.orderId;
    const o = await expectOrderAddsUp(transferOrder);
    totals.set(transferOrder, o.total);
    await expectStock(2, 1);

    const up = await request(app)
      .post(`/api/v1/stores/${A.storeId}/payments/orders/${transferOrder}/proof-image`)
      .set("Authorization", `Bearer ${shopper.token}`)
      .attach("file", png, { filename: "receipt.png", contentType: "image/png" });
    expect(up.status).toBe(201);
    const sent = await api("POST", `/stores/${A.storeId}/payments/orders/${transferOrder}/proof`, {
      token: shopper.token,
      body: { imageKey: up.body.key, declaredAmount: o.total, declaredReference: `TRX-${suffix}` },
    });
    expect(sent.status).toBe(201);
    expect(sent.json.status).toBe("pending");

    const mine = await api("GET", `/stores/${A.storeId}/orders/mine`, { token: shopper.token });
    expect(mine.json.data.map((x: { id: string }) => x.id)).toContain(transferOrder);
  });

  it("staff: checks the receipt and accepts it; records the delivery cash; never more than their permission", async () => {
    const queue = await api("GET", `/stores/${A.storeId}/payments/proofs?status=pending`, { token: clerk.token });
    expect(queue.status).toBe(200);
    const proof = queue.json.find((p: { orderId: string }) => p.orderId === transferOrder);
    expect(proof).toBeTruthy();
    const accepted = await api("POST", `/stores/${A.storeId}/payments/proofs/${proof.id}/review`, { token: clerk.token, body: { decision: "accept" } });
    expect(accepted.status).toBe(200);
    expect((await orderOf(transferOrder)).status).toBe("paid");

    const collected = await api("POST", `/stores/${A.storeId}/payments/cod/orders/${codOrder}/outcome`, { token: clerk.token, body: { outcome: "collected", amount: totals.get(codOrder) } });
    expect(collected.status).toBe(200);
    // Cash in hand at the door: the order is paid and delivered in one step.
    expect((await orderOf(codOrder)).status).toBe("completed");

    // The clerk may not refund (that is the "refunds" permission) or sell on the register.
    expect((await api("POST", `/stores/${A.storeId}/orders/${codOrder}/refund`, { token: clerk.token, body: {} })).status).toBe(403);
    expect((await api("POST", `/stores/${A.storeId}/pos/shift/open`, { token: clerk.token, body: { openingFloat: 0 } })).status).toBe(403);
  });

  it("cashier: opens the drawer, sells a cup in the shop, and closes with no difference", async () => {
    const P = (p: string) => `/stores/${A.storeId}/pos${p}`;
    expect((await api("POST", P("/shift/open"), { token: cashier.token, body: { openingFloat: 1000 } })).status).toBe(201);
    const quote = await api("POST", P("/quote"), { token: cashier.token, body: { items: [{ productId: product.cup, quantity: 1 }] } });
    expect(quote.status).toBe(200);
    const sale = await api("POST", P("/sales"), { token: cashier.token, body: { items: [{ productId: product.cup, quantity: 1 }], payments: [{ method: "cash", amount: quote.json.total, tendered: quote.json.total }] } });
    expect(sale.status).toBe(201);
    posSale = sale.json.id;
    totals.set(posSale, sale.json.total);
    // One shelf for both channels: the online orders and the register drew on the same stock.
    await expectStock(3, 1);

    const shift = (await api("GET", P("/shift"), { token: cashier.token })).json;
    expect(shift.expectedCash).toBe(round2(1000 + sale.json.total));
    const closed = await api("POST", P("/shift/close"), { token: cashier.token, body: { countedCash: shift.expectedCash } });
    expect(closed.status).toBe(200);
    expect(closed.json.variance).toBe(0);
    // The cashier sells; reading the business is not theirs.
    expect((await api("GET", `/stores/${A.storeId}/analytics/summary`, { token: cashier.token })).status).toBe(403);
  });

  it("owner: the dashboard agrees with the orders, across both channels", async () => {
    const s = (await api("GET", `/stores/${A.storeId}/analytics/summary`, { token: A.token })).json;
    const expected = round2([...totals.values()].reduce((a, b) => a + b, 0));
    expect(s.totals.orders).toBe(3);
    expect(s.totals.grossSales).toBe(expected);
    expect(s.totals.netSales).toBe(expected);
    const online = s.byChannel.find((c: { channel: string }) => c.channel === "online");
    const pos = s.byChannel.find((c: { channel: string }) => c.channel === "pos");
    expect(round2(online.grossSales + pos.grossSales)).toBe(expected);
    expect(pos.grossSales).toBe(totals.get(posSale));
  });

  it("owner: refunds the shawl with restock; stock and the dashboard both follow", async () => {
    const refund = await api("POST", `/stores/${A.storeId}/orders/${transferOrder}/refund`, { token: A.token, body: { restock: true, reason: "Changed her mind" } });
    expect(refund.status).toBe(200);
    await expectStock(3, 0);
    // The dashboard is served from a five-minute cache, and says so: the same question a moment
    // later is answered from it, labelled `cached`.
    expect((await api("GET", `/stores/${A.storeId}/analytics/summary`, { token: A.token })).json.cached).toBe(true);
    // A fresh question (a window ending tomorrow) is computed now, and the refund is in it.
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const monthAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString(); // within the Free plan's 30 days
    const fresh = await api("GET", `/stores/${A.storeId}/analytics/summary?from=${monthAgo}&to=${tomorrow}`, { token: A.token });
    expect(fresh.json.cached).toBe(false);
    const s = fresh.json;
    const gross = round2([...totals.values()].reduce((a, b) => a + b, 0));
    expect(s.totals.grossSales).toBe(gross);
    expect(s.totals.netSales).toBe(round2(gross - totals.get(transferOrder)!));
    // A refund is never given twice.
    expect((await api("POST", `/stores/${A.storeId}/orders/${transferOrder}/refund`, { token: A.token, body: {} })).status).toBe(409);
  });

  it("another owner: sees none of it", async () => {
    for (const [method, p] of [
      ["GET", `/stores/${A.storeId}/orders`],
      ["GET", `/stores/${A.storeId}/orders/${codOrder}`],
      ["GET", `/stores/${A.storeId}/payments/proofs`],
      ["GET", `/stores/${A.storeId}/analytics/summary`],
      ["GET", `/stores/${A.storeId}/pos/sales/${posSale}`],
    ] as const) {
      expect([403, 404]).toContain((await api(method, p, { token: B.token })).status);
    }
    // B's own dashboard is untouched by A's day.
    expect((await api("GET", `/stores/${B.storeId}/analytics/summary`, { token: B.token })).json.totals.orders).toBe(0);
    // The shopper's account sees their own orders in A, and nothing in B.
    expect((await api("GET", `/stores/${B.storeId}/orders/mine`, { token: shopper.token })).json.data).toEqual([]);
  });

  it("platform admin: sees the store in the platform totals, and no customer data", async () => {
    expect((await api("GET", "/platform/summary", { token: B.token })).status).toBe(403);
    await prismaUnscoped.user.update({ where: { id: B.userId }, data: { platformRole: "SUPER_ADMIN" } });
    const summary = await api("GET", "/platform/summary", { token: B.token });
    expect(summary.status).toBe(200);
    expect(summary.json.stores).toBeGreaterThanOrEqual(2);
    const list = await api("GET", `/platform/tenants?q=${A.slug}`, { token: B.token });
    expect(list.status).toBe(200);
    expect(list.json.data).toHaveLength(1);
    expect(JSON.stringify(list.json)).not.toMatch(/@|03001112222|03003334444|Aisha|Bilal/);
  });
});
