/**
 * Regression tests for the security audit of 2026-11 (documentation/Audit_Report_2026-11.md). Each
 * block reproduces one audited weakness with throwaway stores and accounts on the local Postgres,
 * MongoDB and Redis, and passes only with its fix. A fake AI provider stands in for the real one, so
 * nothing here spends money or reaches an outside service.
 */
process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_QUEUE_NAME = `ai-generate-verify-audit-${Date.now().toString(36)}`;
process.env.AI_CACHE_SECONDS = "0";
process.env.COD_PHONE_PEPPER = `test-pepper-${Date.now()}`;

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let Product: typeof import("../../src/models/Product.model").Product;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[], keys: [] as string[] };
const aiCalls: { prompt: string; hasImage: boolean }[] = [];
let aiReply: Record<string, unknown> | string = {};

async function api(method: string, p: string, opts: { token?: string; guest?: string; body?: unknown } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${p}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  if (opts.guest) req = req.set("X-Guest-Session-Id", opts.guest);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

async function merchant(tag: string) {
  const email = `verify-audit-${tag}-${suffix}@example.com`;
  const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `Verify Audit ${tag}`, storeSlug: `verify-audit-${tag}-${suffix}`, currency: "PKR" } });
  const storeId = (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id as string;
  created.tenantIds.push(storeId);
  created.userIds.push(reg.json.user.id);
  return { token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string, email };
}

async function shopperAccount(tag: string) {
  const email = `verify-audit-shopper-${tag}-${suffix}@example.com`;
  const reg = await api("POST", "/auth/register-customer", { body: { email, password: "password123", name: `Shopper ${tag}` } });
  created.userIds.push(reg.json.user.id);
  return { token: reg.json.accessToken as string, userId: reg.json.user.id as string, email };
}

const address = { line1: "12 Mall Road", city: "Lahore", country: "PK" };

let A: Awaited<ReturnType<typeof merchant>>;
let cup: string;

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ Product } = await import("../../src/models/Product.model"));
  await (await import("../../src/lib/mongo")).connectMongo();
  (await import("../../src/lib/aiProvider")).setAiProvider({
    async generate(p) {
      aiCalls.push({ prompt: p.prompt, hasImage: Boolean(p.image) });
      return { text: typeof aiReply === "string" ? aiReply : JSON.stringify(aiReply), model: p.model, inputTokens: 100, outputTokens: 40 };
    },
  });
  (await import("../../src/lib/aiQueue")).startAiWorker();

  A = await merchant("a");
  cup = (await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "Clay Chai Cup", price: 450, stock: 500, category: "kitchen" } })).json.id;
  await api("PATCH", `/stores/${A.storeId}/payments/settings`, { token: A.token, body: { codEnabled: true, bankTransferEnabled: true, bankAccountName: "Verify Audit A", bankAccountNumber: "PK00TEST000011112222", bankName: "Test Bank" } });
}, 240_000);

afterAll(async () => {
  const storage = (await import("../../src/lib/storage")).getStorage();
  for (const k of created.keys) await storage.remove(k);
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

// ---------------------------------------------------------------------------------------------

describe("an account is linked only to its own customer record (finding: unverified email link)", () => {
  const victimEmail = `verify-audit-victim-${suffix}@example.com`;

  it("typing someone else's email at checkout does not hand over their order history", async () => {
    // The victim checked out as a guest: a customer record with their email and no account.
    const vg = `guest-${suffix}-victim`;
    await api("POST", `/stores/${A.storeId}/cart/items`, { guest: vg, body: { productId: cup, quantity: 1 } });
    const victimOrder = await api("POST", `/stores/${A.storeId}/payments/orders`, { guest: vg, body: { name: "Victim", phone: "03001110000", email: victimEmail, address, method: "bank_transfer" } });
    expect(victimOrder.status).toBe(201);

    // A different, signed-in shopper places an order typing the victim's email.
    const x = await shopperAccount("x");
    await api("POST", `/stores/${A.storeId}/cart/items`, { token: x.token, body: { productId: cup, quantity: 1 } });
    const own = await api("POST", `/stores/${A.storeId}/payments/orders`, { token: x.token, body: { name: "X", phone: "03002220000", email: victimEmail, address, method: "bank_transfer" } });
    expect(own.status).toBe(201);

    const mine = await api("GET", `/stores/${A.storeId}/orders/mine`, { token: x.token });
    expect(mine.status).toBe(200);
    const ids = (mine.json.data ?? mine.json).map((o: { id: string }) => o.id);
    expect(ids).toContain(own.json.orderId);
    expect(ids).not.toContain(victimOrder.json.orderId);
    expect((await api("GET", `/stores/${A.storeId}/orders/${victimOrder.json.orderId}`, { token: x.token })).status).toBe(404);

    const victimRecord = await prismaUnscoped.customer.findFirst({ where: { tenantId: A.storeId, email: victimEmail } });
    expect(victimRecord?.userId).toBeNull();
  });

  it("a guest who later signs up with the same email still finds their earlier order", async () => {
    const email = `verify-audit-returning-${suffix}@example.com`;
    const g = `guest-${suffix}-returning`;
    await api("POST", `/stores/${A.storeId}/cart/items`, { guest: g, body: { productId: cup, quantity: 1 } });
    const earlier = await api("POST", `/stores/${A.storeId}/payments/orders`, { guest: g, body: { name: "Returning", phone: "03003330000", email, address, method: "bank_transfer" } });
    expect(earlier.status).toBe(201);

    const reg = await api("POST", "/auth/register-customer", { body: { email, password: "password123", name: "Returning" } });
    created.userIds.push(reg.json.user.id);
    await api("POST", `/stores/${A.storeId}/cart/items`, { token: reg.json.accessToken, body: { productId: cup, quantity: 1 } });
    const later = await api("POST", `/stores/${A.storeId}/payments/orders`, { token: reg.json.accessToken, body: { name: "Returning", phone: "03003330000", email, address, method: "bank_transfer" } });
    expect(later.status).toBe(201);

    const ids = ((await api("GET", `/stores/${A.storeId}/orders/mine`, { token: reg.json.accessToken })).json.data ?? []).map((o: { id: string }) => o.id);
    expect(ids).toEqual(expect.arrayContaining([earlier.json.orderId, later.json.orderId]));
  });
});

describe("a cash-on-delivery order settles exactly once (finding: COD outcome check-then-act)", () => {
  const stockOf = async () => (await prismaUnscoped.inventoryLevel.findFirst({ where: { tenantId: A.storeId, productId: cup }, select: { quantity: true } }))?.quantity ?? 0;
  const placeCod = async (tag: string, phone: string) => {
    const g = `guest-${suffix}-${tag}`;
    await api("POST", `/stores/${A.storeId}/cart/items`, { guest: g, body: { productId: cup, quantity: 2 } });
    const res = await api("POST", `/stores/${A.storeId}/payments/orders`, { guest: g, body: { name: "Cod", phone, email: `verify-audit-${tag}-${suffix}@example.com`, address, method: "cod" } });
    expect(res.status).toBe(201);
    return res.json.orderId as string;
  };
  const signal = async (phone: string) => {
    const { hashPhone } = await import("../../src/modules/payments/payments.service");
    return prismaUnscoped.codPhoneSignal.findFirst({ where: { phoneHash: hashPhone(phone)! } });
  };
  afterAll(async () => {
    const { hashPhone } = await import("../../src/modules/payments/payments.service");
    await prismaUnscoped.codPhoneSignal.deleteMany({ where: { phoneHash: { in: ["03004440001", "03004440002"].map((p) => hashPhone(p)!) } } });
  });

  it("two refusals recorded at the same moment put the stock back once and count one refusal", async () => {
    const orderId = await placeCod("cod-race", "03004440001");
    const before = await stockOf();
    const outcome = () => api("POST", `/stores/${A.storeId}/payments/cod/orders/${orderId}/outcome`, { token: A.token, body: { outcome: "refused" } });
    const [r1, r2] = await Promise.all([outcome(), outcome()]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await stockOf()).toBe(before + 2);
    expect((await signal("03004440001"))?.refused).toBe(1);
  });

  it("a cancelled order cannot be brought back by recording the cash as collected", async () => {
    const orderId = await placeCod("cod-cancelled", "03004440002");
    expect((await api("PATCH", `/stores/${A.storeId}/orders/${orderId}/status`, { token: A.token, body: { status: "cancelled" } })).status).toBe(200);
    const res = await api("POST", `/stores/${A.storeId}/payments/cod/orders/${orderId}/outcome`, { token: A.token, body: { outcome: "collected" } });
    expect(res.status).toBe(409);
    const order = await prismaUnscoped.order.findFirst({ where: { id: orderId }, include: { payments: true } });
    expect(order?.status).toBe("CANCELLED");
    expect(order?.payments.every((p) => p.status !== "SUCCEEDED")).toBe(true);
    expect(await signal("03004440002")).toBeNull();
  });
});

describe("a sale is never refunded for more than was paid (finding: refund versus partial return race)", () => {
  it("a partial return that lands while a whole-order refund is starting stops the refund", async () => {
    const P = (p: string) => `/stores/${A.storeId}/pos${p}`;
    await api("POST", P("/shift/open"), { token: A.token, body: { openingFloat: 0 } });
    const sale = await api("POST", P("/sales"), { token: A.token, body: { items: [{ productId: cup, quantity: 2 }], payments: [{ method: "cash", amount: 900, tendered: 900 }] } });
    expect(sale.status).toBe(201);
    const itemId = sale.json.items.find((i: { productId: string }) => i.productId === cup).id as string;

    // The refund has already passed its "nothing returned yet" check when the return commits:
    // the return is run just before the refund's transaction starts.
    const { prisma } = await import("../../src/lib/prisma");
    const original = prisma.$transaction.bind(prisma);
    let injected = false;
    const spy = jest.spyOn(prisma, "$transaction").mockImplementation((async (...args: Parameters<typeof prisma.$transaction>) => {
      if (!injected) {
        injected = true;
        const ret = await api("POST", P(`/sales/${sale.json.id}/returns`), { token: A.token, body: { items: [{ orderItemId: itemId, quantity: 1 }] } });
        expect(ret.status).toBe(201);
      }
      return (original as (...a: unknown[]) => unknown)(...args);
    }) as never);
    let refund;
    try {
      refund = await api("POST", `/stores/${A.storeId}/orders/${sale.json.id}/refund`, { token: A.token, body: {} });
    } finally {
      spy.mockRestore();
    }
    expect(injected).toBe(true);
    expect(refund.status).toBe(409);

    const returned = await prismaUnscoped.orderReturn.aggregate({ where: { orderId: sale.json.id }, _sum: { amount: true } });
    const refunded = await prismaUnscoped.refund.aggregate({ where: { orderId: sale.json.id }, _sum: { amount: true } });
    const paidBack = Number(returned._sum.amount ?? 0) + Number(refunded._sum.amount ?? 0);
    expect(paidBack).toBeLessThanOrEqual(900);
    await api("POST", P("/shift/close"), { token: A.token, body: { countedCash: 450 } });
  });
});
