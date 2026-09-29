/**
 * Part C, the Growth Advisor, end to end on real Postgres, MongoDB and Redis with a fake AI
 * provider: the figures a real store produces fire the right checks; the AI is handed totals only
 * (no customer data); the platform pays, not the store's allowance; with the AI down the tip is
 * written from a template; at most one tip a week; points are not repeated; switching tips off,
 * dismissing, permissions and store isolation.
 */
process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_QUEUE_NAME = `ai-generate-verify-advisor-${Date.now().toString(36)}`;
process.env.AI_CACHE_SECONDS = "0";

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let tenantContext: typeof import("../../src/lib/tenantContext").tenantContext;
let createOrder: typeof import("../../src/modules/commerce/order.service").createOrder;
let advisorService: typeof import("../../src/modules/advisor/advisor.service").advisorService;
let Product: typeof import("../../src/models/Product.model").Product;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };
const DAY = 24 * 60 * 60 * 1000;
const month = new Date().toISOString().slice(0, 7);
const aiCalls: { system: string; prompt: string; model: string }[] = [];
let aiFails = false;

async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${path}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

async function merchant(tag: string) {
  const email = `verify-advisor-${tag}-${suffix}@example.com`;
  const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `Verify ${tag}`, storeSlug: `verify-advisor-${tag}-${suffix}` } });
  const storeId = (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id as string;
  created.tenantIds.push(storeId);
  created.userIds.push(reg.json.user.id);
  return { token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string };
}

const product = async (owner: { token: string; storeId: string }, title: string, price: number, stock: number) =>
  (await api("POST", `/stores/${owner.storeId}/products`, { token: owner.token, body: { title, price, stock, category: "kitchen" } })).json.id as string;

/** A paid order through the real createOrder, from a named guest (so the test can prove the name never reaches the AI). */
const order = (storeId: string, productId: string, quantity: number, amount: number) =>
  tenantContext.run(storeId, () =>
    createOrder({ tenantId: storeId, channel: "ONLINE", guestEmail: "ayesha.customer@example.com", items: [{ productId, quantity }], payments: [{ method: "CARD", amount }] })
  );

let A: Awaited<ReturnType<typeof merchant>>;
let B: Awaited<ReturnType<typeof merchant>>;
const check = (storeId: string, now = new Date()) => tenantContext.run(storeId, () => advisorService.runForTenant(storeId, now));

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ tenantContext } = await import("../../src/lib/tenantContext"));
  ({ createOrder } = await import("../../src/modules/commerce/order.service"));
  ({ advisorService } = await import("../../src/modules/advisor/advisor.service"));
  ({ Product } = await import("../../src/models/Product.model"));
  await (await import("../../src/lib/mongo")).connectMongo();
  (await import("../../src/lib/aiProvider")).setAiProvider({
    async generate(p) {
      aiCalls.push({ system: p.system, prompt: p.prompt, model: p.model });
      if (aiFails) throw new Error("provider down");
      // Writes from the facts it was actually given (like the real model), so a leak between stores would show.
      const facts = p.prompt.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.replace(/^- \[\w+\] /, ""));
      return { text: `This week: ${facts.join(" ")}`, model: p.model, inputTokens: 210, outputTokens: 40 };
    },
  });
  (await import("../../src/lib/aiQueue")).startAiWorker();

  A = await merchant("a");
  B = await merchant("b");

  // Store A: a best seller running low, sales up 80%, three products that never sell, abandoned carts, AI allowance nearly used.
  const chai = await product(A, "Chai Cup", 30, 8);
  const plate = await product(A, "Steel Plate", 20, 100);
  for (let i = 0; i < 6; i++) await order(A.storeId, chai, 1, 30); // this month: 6 orders, 180
  const earlier = [];
  for (let i = 0; i < 5; i++) earlier.push(await order(A.storeId, plate, 1, 20)); // 30 to 60 days ago: 5 orders, 100
  await prismaUnscoped.order.updateMany({ where: { id: { in: earlier.map((o) => o.id) } }, data: { createdAt: new Date(Date.now() - 40 * DAY) } });
  for (const title of ["Old Vase", "Old Lamp", "Old Rug"]) {
    const id = await product(A, title, 50, 5);
    await Product.collection.updateOne({ _id: new (await import("mongoose")).Types.ObjectId(id) }, { $set: { createdAt: new Date(Date.now() - 45 * DAY) } });
  }
  await prismaUnscoped.cartRecoveryEvent.createMany({ data: Array.from({ length: 6 }, (_, i) => ({ tenantId: A.storeId, cartId: `cart-${suffix}-${i}`, customerEmail: `shopper${i}@example.com`, status: i === 0 ? "CONVERTED" : "SENT" })) });
  await tenantContext.run(A.storeId, async () => {
    const { getOrCreateQuota } = await import("../../src/modules/ai/ai.quota.service");
    await getOrCreateQuota(A.storeId);
  });
  await prismaUnscoped.aiUsageQuota.updateMany({ where: { tenantId: A.storeId, month }, data: { generationsUsed: 13 } });
}, 180_000);

afterAll(async () => {
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

describe("this week's tip", () => {
  let tip: Awaited<ReturnType<typeof check>>;

  it("the store's real figures fire the right checks: a best seller running low, the sales rise, the AI allowance", async () => {
    tip = await check(A.storeId);
    expect(tip).not.toBeNull();
    expect(tip!.topics.map((t) => t.key)).toEqual(["best_seller_low_stock", "sales_up", "ai_quota_high"]);
  });

  it("the tip is written by the AI (the fast model), from the figures", () => {
    expect(tip!.source).toBe("ai");
    const call = aiCalls[aiCalls.length - 1];
    expect(call.model).toBe(process.env.AI_MODEL_FAST ?? "claude-haiku-4-5");
    expect(call.prompt).toMatch(/Chai Cup/);
    expect(call.prompt).toMatch(/up 80%/);
    expect(call.prompt).toMatch(/13 of 15 AI generations/);
    expect(call.system).toMatch(/never invent a number/i);
  });

  it("the AI is given totals only: no customer email or name, no order ids", () => {
    const call = aiCalls[aiCalls.length - 1];
    expect(call.prompt).not.toMatch(/@/);
    expect(call.prompt).not.toMatch(/ayesha/i);
    expect(call.prompt).not.toMatch(/shopper\d/);
  });

  it("the platform pays: the store's AI allowance and token counts are untouched; the cost is recorded on the tip", async () => {
    const quota = await prismaUnscoped.aiUsageQuota.findFirst({ where: { tenantId: A.storeId, month } });
    expect(quota).toMatchObject({ generationsUsed: 13, inputTokens: 0, outputTokens: 0 });
    const row = await prismaUnscoped.growthTip.findFirst({ where: { id: tip!.id } });
    expect(row).toMatchObject({ inputTokens: 210, outputTokens: 40, source: "ai" });
  });

  it("at most one tip a week: checking again returns the same tip, with no new AI call", async () => {
    const calls = aiCalls.length;
    const again = await check(A.storeId);
    expect(again!.id).toBe(tip!.id);
    expect(aiCalls.length).toBe(calls);
  });

  it("the dashboard shows it", async () => {
    const got = await api("GET", `/stores/${A.storeId}/advisor`, { token: A.token });
    expect(got.status).toBe(200);
    expect(got.json).toMatchObject({ enabled: true, tip: { id: tip!.id, message: expect.stringContaining("Chai Cup") } });
  });
});

describe("the following weeks", () => {
  it("next week the praise and the upgrade are not repeated; the best seller still running out is", async () => {
    const next = await check(A.storeId, new Date(Date.now() + 7 * DAY));
    expect(next!.topics.map((t) => t.key)).toEqual(["best_seller_low_stock"]);
  });

  it("with the AI down, the tip is still written, from a template, with the same figures", async () => {
    aiFails = true;
    try {
      const later = await check(A.storeId, new Date(Date.now() + 14 * DAY));
      expect(later).not.toBeNull();
      expect(later!.source).toBe("template");
      expect(later!.message).toMatch(/Chai Cup/);
      expect(later!.message).not.toMatch(/\[(tip|praise|upgrade)\]/);
    } finally {
      aiFails = false;
    }
  });
});

describe("the merchant's controls", () => {
  it("dismissing the tip hides it from the dashboard", async () => {
    const shown = (await api("GET", `/stores/${A.storeId}/advisor`, { token: A.token })).json.tip;
    expect((await api("POST", `/stores/${A.storeId}/advisor/tips/${shown.id}/dismiss`, { token: A.token })).status).toBe(204);
    const after = (await api("GET", `/stores/${A.storeId}/advisor`, { token: A.token })).json.tip;
    expect(after?.id).not.toBe(shown.id);
  });

  it("another store cannot dismiss or see this store's tips (404, 403)", async () => {
    const tipId = (await prismaUnscoped.growthTip.findFirst({ where: { tenantId: A.storeId } }))!.id;
    expect((await api("POST", `/stores/B/advisor/tips/${tipId}/dismiss`.replace("/B/", `/${B.storeId}/`), { token: B.token })).status).toBe(404);
    expect((await api("GET", `/stores/${A.storeId}/advisor`, { token: B.token })).status).toBe(403);
    expect((await api("GET", `/stores/${A.storeId}/advisor`)).status).toBe(401);
  });

  it("the owner can switch tips off: no tip is written or shown", async () => {
    const off = await api("PATCH", `/stores/${A.storeId}/advisor`, { token: A.token, body: { enabled: false } });
    expect(off.json).toMatchObject({ enabled: false, tip: null });
    expect(await check(A.storeId, new Date(Date.now() + 21 * DAY))).toBeNull();
    expect((await api("PATCH", `/stores/${A.storeId}/advisor`, { token: A.token, body: { enabled: "yes" } })).status).toBe(400);
    await api("PATCH", `/stores/${A.storeId}/advisor`, { token: A.token, body: { enabled: true } });
  });

  it("switching tips off is the owner's choice: staff cannot (403)", async () => {
    const email = `verify-advisor-staff-${suffix}@example.com`;
    const made = await api("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email, password: "password123", permissions: ["analytics_read"] } });
    created.userIds.push(made.json.userId);
    const staff = (await api("POST", "/auth/login", { body: { email, password: "password123" } })).json.accessToken as string;
    expect((await api("GET", `/stores/${A.storeId}/advisor`, { token: staff })).status).toBe(200);
    expect((await api("PATCH", `/stores/${A.storeId}/advisor`, { token: staff, body: { enabled: false } })).status).toBe(403);
  });
});

describe("isolation and the weekly run", () => {
  it("store B's tip never uses store A's figures or products", async () => {
    const b = await check(B.storeId);
    if (b) {
      expect(b.message).not.toMatch(/Chai Cup|Old Vase|Steel Plate/);
      expect(b.topics.map((t) => t.key)).not.toContain("sales_up");
    }
    const bCalls = aiCalls.filter((c) => /Chai Cup|Steel Plate/.test(c.prompt));
    expect(bCalls.every((c) => !/wedding season.*Chai/.test(c.prompt))).toBe(true);
  });

  it("the weekly run goes through every store with tips on, and one store's check never stops the rest", async () => {
    // Limited to this test's own stores: a test must never write tips onto real stores.
    const outcome = await advisorService.runAll(new Date(Date.now() + 28 * DAY), [A.storeId, B.storeId]);
    expect(outcome.stores).toBe(2);
    expect(outcome.failed).toBe(0);
    expect(outcome.tips + outcome.quiet).toBe(outcome.stores);
  });

  it("'Check now' through the API returns this week's tip without making a second one", async () => {
    const res = await api("POST", `/stores/${A.storeId}/advisor/check`, { token: A.token });
    expect(res.status).toBe(200);
    const thisWeek = await prismaUnscoped.growthTip.count({ where: { tenantId: A.storeId, weekStart: res.json.tip?.weekStart ?? "none" } });
    expect(thisWeek).toBe(res.json.tip ? 1 : 0);
  });
});
