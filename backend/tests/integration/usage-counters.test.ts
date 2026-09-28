/**
 * Part B, usage counters: every order, whole-order refund and item return updates the store's
 * monthly counters in the same transaction; the counters always equal a fresh recount; a failed
 * order counts nothing; simultaneous orders all count; stores never touch each other's counters;
 * the AI side records tokens only for successful calls and counts cached answers; and the platform
 * view reads the counters. Real Postgres, MongoDB and Redis; Stripe's refund call and the AI
 * provider are faked. Creates throwaway stores and removes them.
 */
process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_QUEUE_NAME = `ai-generate-verify-usage-${Date.now().toString(36)}`;

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let usageService: typeof import("../../src/modules/usage/usage.service").usageService;
let tenantContext: typeof import("../../src/lib/tenantContext").tenantContext;
let createOrder: typeof import("../../src/modules/commerce/order.service").createOrder;
let generate: typeof import("../../src/modules/ai/ai.orchestrator").generate;
let Product: typeof import("../../src/models/Product.model").Product;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };
const month = new Date().toISOString().slice(0, 7);
let aiFails = false;

async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${path}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

async function merchant(tag: string) {
  const email = `verify-usage-${tag}-${suffix}@example.com`;
  const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `Verify ${tag}`, storeSlug: `verify-usage-${tag}-${suffix}` } });
  const storeId = (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id as string;
  created.tenantIds.push(storeId);
  created.userIds.push(reg.json.user.id);
  return { token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string, email };
}

const product = async (owner: { token: string; storeId: string }, title: string, price: number, stock = 1000) =>
  (await api("POST", `/stores/${owner.storeId}/products`, { token: owner.token, body: { title, price, stock, category: "t" } })).json.id as string;

/** An online order through the real createOrder, paid by (fake) Stripe. */
const onlineOrder = (storeId: string, productId: string, quantity: number, amount: number) =>
  tenantContext.run(storeId, () =>
    createOrder({ tenantId: storeId, channel: "ONLINE", items: [{ productId, quantity }], payments: [{ method: "STRIPE", amount, stripePaymentIntentId: `pi_${Math.random().toString(36).slice(2)}` }] })
  );

const counters = (storeId: string) => tenantContext.run(storeId, () => usageService.month(storeId, month));

let A: Awaited<ReturnType<typeof merchant>>;
let B: Awaited<ReturnType<typeof merchant>>;
let mug: string;
let lamp: string;

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ usageService } = await import("../../src/modules/usage/usage.service"));
  ({ tenantContext } = await import("../../src/lib/tenantContext"));
  ({ createOrder } = await import("../../src/modules/commerce/order.service"));
  ({ generate } = await import("../../src/modules/ai/ai.orchestrator"));
  ({ Product } = await import("../../src/models/Product.model"));
  await (await import("../../src/lib/mongo")).connectMongo();

  const stripe = await import("../../src/lib/stripe");
  const fail = async (): Promise<never> => {
    throw new Error("not used here");
  };
  stripe.setStripeGateway({
    createCheckoutSession: fail,
    expireCheckoutSession: fail,
    constructEvent: () => {
      throw new Error("not used here");
    },
    createSubscriptionCheckout: fail,
    createTopUpCheckout: fail,
    createBillingPortalSession: fail,
    retrieveSubscription: fail,
    async refundPaymentIntent(_pi, key) {
      return { id: `re_${key}` };
    },
  });
  (await import("../../src/lib/aiProvider")).setAiProvider({
    async generate(p) {
      if (aiFails) throw new Error("provider down");
      return { text: "Category: Kitchen\nTags: mug", model: p.model, inputTokens: 120, outputTokens: 30 };
    },
  });
  (await import("../../src/lib/aiQueue")).startAiWorker();

  A = await merchant("a");
  B = await merchant("b");
  mug = await product(A, "Mug", 10);
  lamp = await product(A, "Lamp", 25);
  await api("POST", `/stores/${A.storeId}/pos/shift/open`, { token: A.token, body: { openingFloat: 100 } });
}, 120_000);

afterAll(async () => {
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

describe("orders", () => {
  it("a new store starts at zero", async () => {
    expect(await counters(A.storeId)).toMatchObject({ orders: 0, grossSales: 0, refundCount: 0, refundTotal: 0 });
  });

  it("an online order counts once, at its total", async () => {
    await onlineOrder(A.storeId, mug, 2, 20);
    expect(await counters(A.storeId)).toMatchObject({ onlineOrders: 1, posOrders: 0, grossSales: 20 });
  });

  it("a register sale counts once, as a POS order", async () => {
    const sale = await api("POST", `/stores/${A.storeId}/pos/sales`, { token: A.token, body: { items: [{ productId: lamp, quantity: 1 }], payments: [{ method: "cash", amount: 25 }] } });
    expect(sale.status).toBe(201);
    expect(await counters(A.storeId)).toMatchObject({ onlineOrders: 1, posOrders: 1, orders: 2, grossSales: 45 });
  });

  it("a retried register sale (same request key) still counts once", async () => {
    const body = { items: [{ productId: mug, quantity: 1 }], payments: [{ method: "card", amount: 10 }], clientRequestId: `usage-${suffix}-retry` };
    await api("POST", `/stores/${A.storeId}/pos/sales`, { token: A.token, body });
    await api("POST", `/stores/${A.storeId}/pos/sales`, { token: A.token, body });
    expect(await counters(A.storeId)).toMatchObject({ posOrders: 2, grossSales: 55 });
  });

  it("an order that fails (not enough stock) counts nothing: the count is rolled back with it", async () => {
    const scarce = await product(A, "Scarce", 5, 1);
    await expect(onlineOrder(A.storeId, scarce, 3, 15)).rejects.toThrow();
    expect(await counters(A.storeId)).toMatchObject({ orders: 3, grossSales: 55 });
  });

  it("20 simultaneous orders all count, none lost and none twice", async () => {
    await Promise.all(Array.from({ length: 20 }, () => onlineOrder(A.storeId, mug, 1, 10)));
    expect(await counters(A.storeId)).toMatchObject({ onlineOrders: 21, orders: 23, grossSales: 255 });
  });
});

describe("refunds and returns", () => {
  it("a whole-order refund counts the money paid back", async () => {
    const order = await onlineOrder(A.storeId, lamp, 1, 25);
    const refund = await api("POST", `/stores/${A.storeId}/orders/${order.id}/refund`, { token: A.token, body: { restock: true } });
    expect(refund.status).toBe(200);
    expect(await counters(A.storeId)).toMatchObject({ grossSales: 280, refundCount: 1, refundTotal: 25, netSales: 255 });
  });

  it("an item returned at the register counts as money paid back", async () => {
    const sale = await api("POST", `/stores/${A.storeId}/pos/sales`, { token: A.token, body: { items: [{ productId: mug, quantity: 3 }], payments: [{ method: "cash", amount: 30 }] } });
    const itemId = sale.json.items[0].id as string;
    const ret = await api("POST", `/stores/${A.storeId}/pos/sales/${sale.json.id}/returns`, { token: A.token, body: { items: [{ orderItemId: itemId, quantity: 1 }] } });
    expect(ret.status).toBe(201);
    expect(await counters(A.storeId)).toMatchObject({ grossSales: 310, refundCount: 2, refundTotal: 35 });
  });

  it("the counters always equal a fresh recount from the orders, refunds and returns", async () => {
    const counted = await counters(A.storeId);
    const recounted = await usageService.recount(A.storeId, month);
    expect(recounted).toEqual(counted);
  });

  it("recount with repair rebuilds a damaged month", async () => {
    await prismaUnscoped.tenantMonthlyUsage.updateMany({ where: { tenantId: A.storeId, month }, data: { onlineOrders: 999, grossSales: "1" } });
    const repaired = await usageService.recount(A.storeId, month, { repair: true });
    expect(await counters(A.storeId)).toEqual(repaired);
    expect(repaired.onlineOrders).toBe(22);
  });
});

describe("isolation and history", () => {
  it("store B's counters are untouched by all of store A's activity", async () => {
    expect(await counters(B.storeId)).toMatchObject({ orders: 0, grossSales: 0, refundCount: 0 });
  });

  it("history gives the last months oldest first, empty months as zeros", async () => {
    const h = await tenantContext.run(A.storeId, () => usageService.history(A.storeId, 3));
    expect(h.map((m) => m.month)).toHaveLength(3);
    expect(h[2].month).toBe(month);
    expect(h[2].orders).toBeGreaterThan(0);
    expect(h[0]).toMatchObject({ orders: 0, grossSales: 0 });
  });
});

describe("AI usage", () => {
  const quota = () => prismaUnscoped.aiUsageQuota.findFirst({ where: { tenantId: B.storeId, month } });
  // generate() runs inside a request's store context in the app; here it is given one the same way.
  const inStore = <T>(fn: () => Promise<T>) => tenantContext.run(B.storeId, fn);

  it("a successful call counts one generation and its tokens", async () => {
    await inStore(() => generate({ tenantId: B.storeId, promptType: "product_description", system: "s", prompt: "a mug" }));
    expect(await quota()).toMatchObject({ generationsUsed: 1, inputTokens: 120, outputTokens: 30, cachedAnswers: 0 });
  });

  it("a failed call counts nothing: no generation, no tokens", async () => {
    aiFails = true;
    await expect(inStore(() => generate({ tenantId: B.storeId, promptType: "product_description", system: "s", prompt: "another" }))).rejects.toThrow();
    aiFails = false;
    expect(await quota()).toMatchObject({ generationsUsed: 1, inputTokens: 120, outputTokens: 30 });
  });

  it("a cached answer counts as cached, and costs neither quota nor tokens", async () => {
    const ask = () => inStore(() => generate({ tenantId: B.storeId, promptType: "auto_tag", system: "tags", prompt: `mug ${suffix}`, cache: true }));
    await ask();
    await ask();
    expect(await quota()).toMatchObject({ generationsUsed: 2, inputTokens: 240, outputTokens: 60, cachedAnswers: 1 });
  });
});

describe("the platform view reads the counters", () => {
  it("per-store orders and sales come from the counters, not from adding up orders", async () => {
    const owner = await prismaUnscoped.user.findUnique({ where: { id: A.userId } });
    await prismaUnscoped.user.update({ where: { id: A.userId }, data: { platformRole: "SUPER_ADMIN" } });
    try {
      const counted = await counters(A.storeId);
      const view = await api("GET", `/platform/tenants?q=verify-usage-a-${suffix}`, { token: A.token });
      expect(view.json.data[0]).toMatchObject({ orders: counted.orders, grossSales: counted.grossSales, refunds: counted.refundTotal, ordersThisMonth: counted.orders });
      const summary = await api("GET", "/platform/summary", { token: A.token });
      expect(summary.json.ordersThisMonth).toBeGreaterThanOrEqual(counted.orders);
      expect(summary.json.aiUsageThisMonth.inputTokens).toBeGreaterThanOrEqual(240);
    } finally {
      await prismaUnscoped.user.update({ where: { id: A.userId }, data: { platformRole: owner!.platformRole } });
    }
  });
});
