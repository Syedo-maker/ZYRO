/**
 * The AI fixes of 2026-10-22, with a fake provider (no real AI call):
 *
 * - a staff member's own permissions reach the UI, and a refusal says in plain words what is missing;
 * - the quota stops a call before the provider is ever asked;
 * - a provider failure gives the caller a readable 503, spends nothing, and keeps the provider's
 *   own words out of the response;
 * - the shopping assistant quotes the store's currency and knows the MRP and discount, and only ever
 *   sees its own store's products;
 * - auto-tag is shown the store's own categories;
 * - abandoned-cart recovery skips a cart whose store is gone, writes nothing (and spends nothing)
 *   while email is not configured, and names a fixed discount in the store's currency.
 */
process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_CACHE_SECONDS = "0";
process.env.AI_MONTHLY_GENERATIONS_LIMIT = "3";
// Email starts unconfigured, as on a machine without SendGrid; one test below supplies a gateway.
delete process.env.SENDGRID_API_KEY;
delete process.env.SENDGRID_FROM_EMAIL;
// Own queues, so this file's fake provider is what answers even if a dev server shares Redis.
process.env.AI_QUEUE_NAME = `ai-generate-verify-fixes-${Date.now().toString(36)}`;
process.env.CART_RECOVERY_QUEUE_NAME = `cart-recovery-verify-fixes-${Date.now().toString(36)}`;

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let Product: typeof import("../../src/models/Product.model").Product;
let Category: typeof import("../../src/models/Category.model").Category;
let env: typeof import("../../src/config/env").env;
let getRedis: typeof import("../../src/lib/redis").getRedis;
let setEmailGateway: typeof import("../../src/lib/email").setEmailGateway;
let cartRecoveryService: typeof import("../../src/modules/cart-recovery/cartRecovery.service").cartRecoveryService;
let logger: typeof import("../../src/lib/logger").logger;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };
/** Everything the fake provider was asked, and how it should answer next. */
const calls: { promptType?: string; system: string; prompt: string }[] = [];
let reply = "A friendly reply.";
let failWith: Error | null = null;

async function api(method: string, p: string, opts: { token?: string; guest?: string; body?: unknown } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${p}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  if (opts.guest) req = req.set("X-Guest-Session-Id", opts.guest);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

async function owner(tag: string, currency: string) {
  const reg = await api("POST", "/auth/register", {
    body: { email: `verify-aifix-${tag}-${suffix}@example.com`, password: "password123", storeName: `AI Fix ${tag}`, storeSlug: `verify-aifix-${tag}-${suffix}`, currency },
  });
  expect(reg.status).toBe(201);
  const storeId = (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id as string;
  created.tenantIds.push(storeId);
  created.userIds.push(reg.json.user.id);
  return { token: reg.json.accessToken as string, storeId };
}

async function shopper(tag: string) {
  const reg = await api("POST", "/auth/register-customer", { body: { email: `verify-aifix-${tag}-${suffix}@example.com`, password: "password123" } });
  created.userIds.push(reg.json.user.id);
  return { token: reg.json.accessToken as string, userId: reg.json.user.id as string };
}

const usage = async (o: { token: string; storeId: string }) => (await api("GET", `/stores/${o.storeId}/ai-usage`, { token: o.token })).json;
const ageCart = (key: string, hoursAgo: number) => getRedis().expire(key, Math.max(1, env.cartTtlSeconds - hoursAgo * 60 * 60));

let A: Awaited<ReturnType<typeof owner>>;
let B: Awaited<ReturnType<typeof owner>>;
let kettle = "";
let managerToken = "";

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ Product } = await import("../../src/models/Product.model"));
  ({ Category } = await import("../../src/models/Category.model"));
  ({ env } = await import("../../src/config/env"));
  ({ getRedis } = await import("../../src/lib/redis"));
  ({ setEmailGateway } = await import("../../src/lib/email"));
  ({ cartRecoveryService } = await import("../../src/modules/cart-recovery/cartRecovery.service"));
  ({ logger } = await import("../../src/lib/logger"));
  await (await import("../../src/lib/mongo")).connectMongo();
  (await import("../../src/lib/aiProvider")).setAiProvider({
    async generate(p) {
      calls.push({ system: p.system, prompt: p.prompt });
      if (failWith) throw failWith;
      return { text: reply, model: "fake-model-fixes", inputTokens: 40, outputTokens: 12 };
    },
  });
  (await import("../../src/lib/aiQueue")).startAiWorker();

  A = await owner("a", "PKR");
  B = await owner("b", "PKR");
  const kitchen = (await api("POST", `/stores/${A.storeId}/categories`, { token: A.token, body: { name: "Kitchen" } })).json.id;
  await api("POST", `/stores/${A.storeId}/categories`, { token: A.token, body: { name: "Home Decor" } });
  kettle = (await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "Copper Kettle", description: "Hand-hammered copper.", actualPrice: 2500, discountPrice: 2000, stock: 5, categoryId: kitchen } })).json.id;
  await api("POST", `/stores/${B.storeId}/products`, { token: B.token, body: { title: "Steel Kettle", actualPrice: 900, stock: 3, category: "Kitchen" } });

  // A manager set up the way the Team page does it: register work, but no Products permission.
  const email = `verify-aifix-mgr-${suffix}@example.com`;
  await api("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email, password: "manager-pass-1", permissions: ["pos_sell", "refunds", "discounts_write", "analytics_read", "orders_write"] } });
  const login = await api("POST", "/auth/login", { body: { email, password: "manager-pass-1" } });
  managerToken = login.json.accessToken;
  created.userIds.push(login.json.user.id);
}, 120_000);

afterAll(async () => {
  setEmailGateway(undefined);
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  await Category.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  await (await import("../../src/lib/cartRecoveryQueue")).closeCartRecoveryQueue();
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

describe("what a staff member may do reaches the UI", () => {
  it("the owner's store lists every permission", async () => {
    const mine = (await api("GET", "/users/me/stores", { token: A.token })).json;
    expect(mine[0]).toMatchObject({ role: "owner" });
    expect(mine[0].permissions).toEqual(expect.arrayContaining(["products_write", "orders_write", "pos_sell", "refunds"]));
  });

  it("a manager's store lists exactly their own permissions, without products_write", async () => {
    const mine = (await api("GET", "/users/me/stores", { token: managerToken })).json;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: A.storeId, role: "staff" });
    expect(mine[0].permissions.sort()).toEqual(["analytics_read", "discounts_write", "orders_write", "pos_sell", "refunds"]);
  });

  it("an AI tool refused for a missing permission says which one, in plain words, and who can give it", async () => {
    const res = await api("POST", `/stores/${A.storeId}/products/${kettle}/ai-description/generate`, { token: managerToken });
    expect(res.status).toBe(403);
    expect(res.json.detail).toMatch(/Products \(adding and editing products, and the AI writing tools\) permission/);
    expect(res.json.detail).toMatch(/Ask the store owner/);
    expect(calls).toHaveLength(0);
  });
});

describe("the shopping assistant", () => {
  it("quotes the store's own currency, with the MRP and discount, never dollars", async () => {
    reply = "Yes, the Copper Kettle is in stock.";
    const res = await api("POST", `/stores/${A.storeId}/assistant/chat`, { guest: `guest-${suffix}-aifixes01`, body: { conversationId: `c-${suffix}-1`, message: "Is the copper kettle on sale?" } });
    expect(res.status).toBe(200);
    const sent = calls[calls.length - 1].system;
    expect(sent).toMatch(/Copper Kettle \(Rs 2,000\.00, reduced from Rs 2,500\.00 \(20% off\), Kitchen\)/);
    expect(sent).not.toMatch(/\$/);
  });

  it("sees only its own store's products", async () => {
    await api("POST", `/stores/${B.storeId}/assistant/chat`, { guest: `guest-${suffix}-aifixes02`, body: { conversationId: `c-${suffix}-2`, message: "Do you have a copper kettle?" } });
    const sent = calls[calls.length - 1].system;
    expect(sent).not.toMatch(/Copper Kettle/);
    const fromA = await api("POST", `/stores/${A.storeId}/assistant/chat`, { guest: `guest-${suffix}-aifixes03`, body: { conversationId: `c-${suffix}-3`, message: "Do you have a steel kettle?" } });
    expect(calls[calls.length - 1].system).not.toMatch(/Steel Kettle/);
    expect(fromA.json.suggestedProducts.map((p: { title: string }) => p.title)).not.toContain("Steel Kettle");
  });
});

describe("auto-tag", () => {
  it("is shown the store's own categories, so its suggestion can be applied", async () => {
    reply = "Category: Kitchen\nTags: copper, kettle, chai";
    const res = await api("POST", `/stores/${A.storeId}/products/${kettle}/auto-tag`, { token: A.token });
    expect(res.status).toBe(200);
    expect(res.json.category).toBe("Kitchen");
    expect(calls[calls.length - 1].prompt).toMatch(/The store's categories: Home Decor, Kitchen/);
    expect(calls[calls.length - 1].system).toMatch(/use that category's name exactly as written/);
  });
});

describe("the provider and the quota", () => {
  it("a provider failure is a readable 503, gives the allowance back, and keeps the provider's words out of the response", async () => {
    const before = (await usage(A)).generationsUsed;
    failWith = new Error("401 authentication_error: invalid x-api-key");
    const errors = jest.spyOn(logger, "error");
    const res = await api("POST", `/stores/${A.storeId}/products/${kettle}/seo-metadata/generate`, { token: A.token });
    failWith = null;
    expect(res.status).toBe(503);
    expect(res.json.detail).toBe("The AI service is unavailable right now. Nothing was used from your AI allowance; please try again in a minute.");
    expect(JSON.stringify(res.json)).not.toMatch(/x-api-key|authentication_error/);
    expect((await usage(A)).generationsUsed).toBe(before);
    // The details are in the log, where they can be acted on.
    expect(errors.mock.calls.some(([fields, msg]) => msg === "AI generation failed" && /invalid x-api-key/.test(String((fields as { err?: string }).err)))).toBe(true);
    errors.mockRestore();
  }, 60_000);

  it("once the allowance is used up, the call is refused before the provider is asked", async () => {
    reply = "Title: Copper Kettle | Handmade\nDescription: A hand-hammered copper kettle.";
    while ((await usage(A)).generationsUsed < 3) {
      expect((await api("POST", `/stores/${A.storeId}/products/${kettle}/seo-metadata/generate`, { token: A.token })).status).not.toBe(402);
    }
    const asked = calls.length;
    const refused = await api("POST", `/stores/${A.storeId}/products/${kettle}/seo-metadata/generate`, { token: A.token });
    expect(refused.status).toBe(402);
    expect(calls.length).toBe(asked);
  }, 60_000);
});

describe("abandoned-cart recovery", () => {
  let cartKey = "";

  it("while email is not configured, a due cart costs no AI call and no allowance, and is not marked sent", async () => {
    const c = await shopper("c1");
    await api("POST", `/stores/B/cart/items`.replace("B", B.storeId), { token: c.token, body: { productId: (await Product.findOne({ storeId: B.storeId }))!._id.toString(), quantity: 1 } });
    cartKey = `cart:${B.storeId}:u:${c.userId}`;
    await ageCart(cartKey, env.cartRecovery.abandonedAfterHours + 1);
    const before = { calls: calls.length, used: (await usage(B)).generationsUsed };
    const warnings = jest.spyOn(logger, "warn");
    await cartRecoveryService.scan();
    expect(calls.length).toBe(before.calls);
    expect((await usage(B)).generationsUsed).toBe(before.used);
    expect(await prismaUnscoped.cartRecoveryEvent.count({ where: { tenantId: B.storeId } })).toBe(0);
    expect(warnings.mock.calls.some(([, msg]) => /email sending is not set up/.test(String(msg)))).toBe(true);
    warnings.mockRestore();
  }, 60_000);

  it("a cart whose store has been deleted is skipped without an error", async () => {
    const c = await shopper("c2");
    const orphan = `cart:deleted-store-${suffix}:u:${c.userId}`;
    await getRedis().hset(orphan, "64b7f0f0f0f0f0f0f0f0f0f0", "1");
    await ageCart(orphan, env.cartRecovery.abandonedAfterHours + 1);
    const errors = jest.spyOn(logger, "error");
    await cartRecoveryService.scan();
    // Before the fix every such cart logged "Store not found" here, on every scan.
    expect(errors.mock.calls.filter(([, msg]) => msg === "cart recovery failed for one cart")).toEqual([]);
    errors.mockRestore();
    await getRedis().del(orphan);
  }, 60_000);

  it("with email working, the message is written once and names a fixed discount in the store's currency", async () => {
    const sent: { to: string; text: string }[] = [];
    setEmailGateway({ async send(m) { sent.push({ to: m.to, text: m.text }); } });
    await api("POST", `/stores/${B.storeId}/discount-codes`, { token: B.token, body: { code: `BACK${suffix}`.slice(0, 30), type: "fixed", value: 100 } });
    reply = "Your steel kettle is waiting for you.";
    const before = (await usage(B)).generationsUsed;
    await cartRecoveryService.scan();
    expect(sent).toHaveLength(1);
    expect((await usage(B)).generationsUsed).toBe(before + 1);
    const prompt = calls[calls.length - 1].prompt;
    expect(prompt).toMatch(/\(Rs 100\.00 off\)/);
    expect(prompt).not.toMatch(/\$/);
    setEmailGateway(undefined);
    await getRedis().del(cartKey);
  }, 60_000);
});
