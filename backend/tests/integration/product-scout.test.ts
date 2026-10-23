/**
 * Product Scout end to end on real Postgres, MongoDB and Redis, with a fake AI provider:
 *
 * - the figures from seeded orders (growth on the previous period, pending, cancelled and refunded
 *   orders left out, returned units taken off);
 * - the privacy rules: fewer than 3 stores, one store over 60% of the units, or the two biggest over
 *   85% together, is never shown, and no store, order, product or customer identifier leaves the API;
 * - a shop whose owner switched off "Include my shop's sales in shared platform trends" is left out of
 *   Product Scout and Trend Scout from the next run, and still sees the trends; only the owner may
 *   change it;
 * - the AI only words the figures it is given (a line with an invented number is replaced);
 * - market data where ZYRO has too little, and the store's own empty categories named as such;
 * - a page load reads the saved snapshot: no AI call, no recalculation;
 * - Owner and Manager see it, a Cashier and another store's owner do not;
 * - demo stores never reach the real figures (Product Scout, Trend Scout, the directory), and their
 *   prefix cannot be registered.
 *
 * The test stores trade in NPR, a currency no development store uses, so a run here never replaces the
 * snapshot a real store reads; the NPR snapshots are deleted afterwards. If a dev backend is running
 * against the same database, its own Product Scout run (on its first start, or the daily one) covers
 * these stores too and can replace the NPR snapshot mid-test; in CI nothing else runs.
 */
process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_CACHE_SECONDS = "0";
process.env.AI_QUEUE_NAME = `ai-generate-verify-scout-${Date.now().toString(36)}`;
process.env.SCOUT_MIN_STORES = "3";
process.env.SCOUT_MAX_STORE_SHARE = "0.6";
process.env.SCOUT_MAX_TOP_TWO_SHARE = "0.85";

import request from "supertest";
import type { Express } from "express";

const MARKET = "NPR";
const DAY_MS = 24 * 60 * 60 * 1000;

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let Product: typeof import("../../src/models/Product.model").Product;
let Category: typeof import("../../src/models/Category.model").Category;
let scoutService: typeof import("../../src/modules/scout/scout.service").scoutService;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[], trendReportIds: [] as string[] };
const aiCalls: string[] = [];
const secrets: string[] = []; // every store id, name, slug, email, product id and order id made here

async function api(method: string, p: string, opts: { token?: string; body?: unknown } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${p}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

interface Shop {
  token: string;
  storeId: string;
  userId: string;
  products: Record<string, string>;
  nextOrder: number;
}

async function shop(tag: string): Promise<Shop> {
  const email = `verify-scout-${tag}-${suffix}@example.com`;
  const name = `Scout ${tag} ${suffix}`;
  const slug = `verify-scout-${tag}-${suffix}`;
  const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: name, storeSlug: slug, currency: MARKET } });
  expect(reg.status).toBe(201);
  const storeId = (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id as string;
  created.tenantIds.push(storeId);
  created.userIds.push(reg.json.user.id);
  secrets.push(storeId, name, slug, email, reg.json.user.id);
  return { token: reg.json.accessToken, storeId, userId: reg.json.user.id, products: {}, nextOrder: 1 };
}

async function product(s: Shop, key: string, title: string, category: string) {
  const cats = (await api("GET", `/stores/${s.storeId}/categories`, { token: s.token })).json as { id: string; name: string }[];
  const categoryId = cats.find((c) => c.name === category)?.id ?? (await api("POST", `/stores/${s.storeId}/categories`, { token: s.token, body: { name: category } })).json.id;
  const res = await api("POST", `/stores/${s.storeId}/products`, { token: s.token, body: { title, actualPrice: 500, stock: 100, categoryId } });
  expect(res.status).toBe(201);
  s.products[key] = res.json.id;
  secrets.push(res.json.id);
}

/** An order straight into the database, `daysAgo` days back, with one line per item. */
async function order(s: { storeId: string; nextOrder: number }, items: { productId: string; title: string; qty: number; returned?: number }[], status: string, daysAgo: number) {
  const total = items.reduce((t, i) => t + i.qty * 500, 0);
  const o = await prismaUnscoped.order.create({
    data: {
      tenantId: s.storeId,
      orderNumber: s.nextOrder++,
      status: status as never,
      currency: MARKET,
      subtotal: total.toFixed(2),
      total: total.toFixed(2),
      guestEmail: `buyer-${suffix}@example.com`,
      createdAt: new Date(Date.now() - daysAgo * DAY_MS),
      items: {
        create: items.map((i) => ({
          productId: i.productId,
          productTitleSnapshot: i.title,
          unitPrice: "500.00",
          quantity: i.qty,
          returnedQuantity: i.returned ?? 0,
          lineTotal: (i.qty * 500).toFixed(2),
        })),
      },
    },
  });
  secrets.push(o.id);
}

let A: Shop, B: Shop, C: Shop, D: Shop, other: Shop;
let managerToken = "";
let cashierToken = "";
const demos: { storeId: string; nextOrder: number; token: string; productId: string }[] = [];

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ Product } = await import("../../src/models/Product.model"));
  ({ Category } = await import("../../src/models/Category.model"));
  ({ scoutService } = await import("../../src/modules/scout/scout.service"));
  await (await import("../../src/lib/mongo")).connectMongo();

  // A fake AI: explains each fact with its own units, except the lamp, where it invents a number.
  (await import("../../src/lib/aiProvider")).setAiProvider({
    async generate(p) {
      aiCalls.push(p.system.slice(0, 30));
      if (p.system.includes("why products are selling")) {
        return {
          text: p.prompt
            .split("\n")
            .map((line) => {
              const [, id, units] = /^(F\d+): .*? sold (\d+) units/.exec(line) ?? [];
              return /^F\d+: Lamp/.test(line) ? `Lamps are flying off the shelves with 999 sold [${id}]` : `Shoppers bought ${units} of these [${id}]`;
            })
            .join("\n"),
          model: "fake-scout",
          inputTokens: 50,
          outputTokens: 30,
        };
      }
      // Starter descriptions: the first is good, the second carries a number (so the template is used).
      return {
        text: "P1: A handy piece for any kitchen. Easy to use and easy to clean.\nP2: Comes in 3 sizes for every home.",
        model: "fake-scout",
        inputTokens: 40,
        outputTokens: 30,
      };
    },
  });
  (await import("../../src/lib/aiQueue")).startAiWorker();

  [A, B, C, D, other] = [await shop("a"), await shop("b"), await shop("c"), await shop("d"), await shop("x")];
  for (const [s, kettle] of [
    [A, "Copper Kettle 1.5L"],
    [B, "copper kettle"],
    [C, "COPPER KETTLE"],
    [D, "Copper Kettle"],
  ] as const) {
    await product(s, "kettle", kettle, "Kitchen");
  }
  for (const s of [A, B, C]) await product(s, "lamp", "Lamp", "Home");
  for (const s of [A, B]) await product(s, "pot", "Steel Pot", "Kitchen");
  await product(D, "hose", "Garden Hose", "Garden");
  for (const s of [A, B, C, other]) await product(s, "mug", "Tea Mug", "Tableware");
  await (await api("POST", `/stores/${D.storeId}/categories`, { token: D.token, body: { name: "Toys" } }));

  const line = (s: Shop, key: string, qty: number, returned = 0) => ({ productId: s.products[key], title: key === "kettle" ? "Copper Kettle" : key, qty, returned });
  // Kettle: 3 stores, this week 4 + 4 + 4 (one of A's has 2 of 6 returned), last week 3 each.
  await order(A, [line(A, "kettle", 6, 2)], "PAID", 2);
  await order(B, [line(B, "kettle", 4)], "COMPLETED", 3);
  await order(C, [line(C, "kettle", 4)], "FULFILLED", 1);
  for (const s of [A, B, C]) await order(s, [line(s, "kettle", 3)], "COMPLETED", 9);
  // D's kettles never count: pending, cancelled and refunded orders.
  await order(D, [line(D, "kettle", 50)], "PENDING", 2);
  await order(D, [line(D, "kettle", 50)], "CANCELLED", 2);
  await order(D, [line(D, "kettle", 50)], "REFUNDED", 2);
  // Lamp: 3 stores, but A sold 20 of 24 (over 60%).
  await order(A, [line(A, "lamp", 20)], "PAID", 2);
  await order(B, [line(B, "lamp", 2)], "PAID", 2);
  await order(C, [line(C, "lamp", 2)], "PAID", 2);
  // Pot: only 2 stores.
  await order(A, [line(A, "pot", 10)], "PAID", 2);
  await order(B, [line(B, "pot", 10)], "PAID", 2);
  // Hose: only D.
  await order(D, [line(D, "hose", 5)], "PAID", 2);
  // Mug: 4 stores and none over 60% (A has 45%), but A and B together sold 90%.
  for (const [s, qty] of [
    [A, 9],
    [B, 9],
    [C, 1],
    [other, 1],
  ] as const)
    await order(s, [line(s, "mug", qty)], "PAID", 2);

  // Staff on A.
  for (const [role, password] of [
    ["manager", "manager-pass-1"],
    ["cashier", "cashier-pass-1"],
  ] as const) {
    const email = `verify-scout-${role}-${suffix}@example.com`;
    await api("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email, password, role } });
    const login = await api("POST", "/auth/login", { body: { email, password } });
    created.userIds.push(login.json.user.id);
    if (role === "manager") managerToken = login.json.accessToken;
    else cashierToken = login.json.accessToken;
  }

  // Three demo stores (made directly: the prefix cannot be registered) selling a lot of kettles.
  const { password } = await import("../../src/lib/password");
  for (let i = 1; i <= 3; i++) {
    const email = `demo-scout-verify-${i}-${suffix}@demo.zyro.local`;
    const user = await prismaUnscoped.user.create({ data: { email, passwordHash: await password.hash("demo-pass-123") } });
    const tenant = await prismaUnscoped.tenant.create({ data: { name: `Demo ${i}`, slug: `demo-scout-verify-${i}-${suffix}`, ownerId: user.id, currency: MARKET, listedInDirectory: true } });
    created.userIds.push(user.id);
    created.tenantIds.push(tenant.id);
    const p = await new Product({ storeId: tenant.id, title: "Copper Kettle", category: "Kitchen", actualPrice: 500, salePrice: 500 }).save();
    const login = await api("POST", "/auth/login", { body: { email, password: "demo-pass-123" } });
    const d = { storeId: tenant.id, nextOrder: 1, token: login.json.accessToken as string, productId: p._id.toString() };
    demos.push(d);
    await order(d, [{ productId: d.productId, title: "Copper Kettle", qty: 100 }], "COMPLETED", 2);
  }

  await scoutService.refresh({ onlyTenantIds: created.tenantIds });
}, 240_000);

afterAll(async () => {
  await prismaUnscoped.productScoutSnapshot.deleteMany({ where: { market: MARKET } });
  await prismaUnscoped.trendReport.deleteMany({ where: { id: { in: created.trendReportIds } } });
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  await Category.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

const scout = (token: string, storeId: string, q = "") => api("GET", `/stores/${storeId}/product-scout${q}`, { token });

describe("the figures", () => {
  it("adds up the kettles across differently written titles, takes off returns, and works out the growth", async () => {
    const res = await scout(A.token, A.storeId);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ status: "ready", demo: false, market: MARKET, periodDays: 7, rules: { minStores: 3, maxSharePercent: 60, maxTopTwoSharePercent: 85 } });
    const kettle = res.json.topSellers.find((p: { name: string }) => p.name === "Copper kettle");
    expect(kettle).toMatchObject({ units: 12, orders: 3, stores: 3, previousUnits: 9, growthPercent: 33, isNew: false, categoryName: "Kitchen" });
  });

  it("pending, cancelled and refunded orders are left out entirely", async () => {
    const kettle = (await scout(A.token, A.storeId)).json.topSellers.find((p: { name: string }) => p.name === "Copper kettle");
    expect(kettle.units).toBe(12); // not 162
    expect(kettle.stores).toBe(3); // D's orders never counted, so D is not a fourth store
  });

  it("the 30-day view covers both weeks, with nothing before to compare against", async () => {
    const res = await scout(A.token, A.storeId, "?period=30");
    const kettle = res.json.topSellers.find((p: { name: string }) => p.name === "Copper kettle");
    expect(kettle).toMatchObject({ units: 21, previousUnits: null, growthPercent: null, isNew: true });
  });

  it("filters by category name in any case", async () => {
    const res = await scout(A.token, A.storeId, "?category=KITCHEN");
    expect(res.json.topSellers.length).toBeGreaterThan(0);
    expect(res.json.topSellers.every((p: { category: string }) => p.category === "kitchen")).toBe(true);
  });
});

describe("privacy", () => {
  it("a product sold by only 2 stores is not shown", async () => {
    const res = await scout(A.token, A.storeId);
    expect(JSON.stringify(res.json)).not.toMatch(/Steel pot/i);
  });

  it("the kitchen total is withheld: minus the kettles it would show the 2 stores' pots", async () => {
    const res = await scout(A.token, A.storeId);
    expect(res.json.categories.map((c: { key: string }) => c.key)).not.toContain("kitchen");
  });

  it("a product where one store sold over 60% of the units is not shown, nor its category", async () => {
    const res = await scout(A.token, A.storeId);
    expect(JSON.stringify(res.json)).not.toMatch(/Lamp/);
    expect(res.json.categories.map((c: { key: string }) => c.key)).not.toContain("home");
  });

  it("a product where the two biggest stores sold over 85% together is not shown, nor its category", async () => {
    for (const q of ["", "?period=30"]) {
      const res = await scout(A.token, A.storeId, q);
      expect(JSON.stringify(res.json)).not.toMatch(/mug/i);
      expect(res.json.categories.map((c: { key: string }) => c.key)).not.toContain("tableware");
    }
  });

  it("no store, order, product or customer identifier appears anywhere in the response", async () => {
    for (const [token, storeId] of [
      [A.token, A.storeId],
      [D.token, D.storeId],
    ] as const) {
      for (const q of ["", "?period=30"]) {
        const text = JSON.stringify((await scout(token, storeId, q)).json);
        for (const secret of secrets.filter((x) => x !== storeId)) expect(text).not.toContain(secret);
        expect(text).not.toMatch(/tenantId|storeId|orderId|productId|email/i);
      }
    }
  });
});

describe("the AI only words the figures", () => {
  it("a line that keeps to the figures is used; the starter description too", async () => {
    const kettle = (await scout(A.token, A.storeId)).json.topSellers.find((p: { name: string }) => p.name === "Copper kettle");
    expect(kettle).toMatchObject({ why: "Shoppers bought 12 of these", whySource: "ai", starter: "A handy piece for any kitchen. Easy to use and easy to clean.", starterSource: "ai" });
  });

  it("the snapshot never holds a number the AI invented", async () => {
    const rows = await prismaUnscoped.productScoutSnapshot.findMany({ where: { market: MARKET } });
    expect(JSON.stringify(rows.map((r) => r.data))).not.toContain("999");
  });
});

describe("too little data", () => {
  it("market data stands in for a category ZYRO has too little on, labelled as such", async () => {
    const report = await prismaUnscoped.trendReport.create({
      data: {
        market: MARKET,
        category: "garden",
        weekStart: new Date(Date.now() - 3 * DAY_MS).toISOString().slice(0, 10),
        status: "published",
        source: "template",
        facts: [{ id: "F1", kind: "external", text: "Searches for garden hose rose 40% in Nepal.", source: "Google Trends (imported)", date: "2026-10-18" }],
        lines: [{ text: "Searches for garden hose rose 40% in Nepal.", cites: ["F1"] }],
      },
    });
    created.trendReportIds.push(report.id);
    await scoutService.refresh({ onlyTenantIds: created.tenantIds, scopes: ["live"] });
    const res = await scout(D.token, D.storeId);
    expect(res.json.marketData).toEqual([expect.objectContaining({ category: "garden", name: "Garden", lines: ["Searches for garden hose rose 40% in Nepal."], sources: ["Google Trends (imported)"] })]);
    // D's own Toys category has neither ZYRO figures nor market data: named, so the owner knows.
    expect(res.json.notEnoughData).toEqual(["Toys"]);
  }, 60_000);

  it("a market with no snapshot at all says so instead of failing", async () => {
    await prismaUnscoped.productScoutSnapshot.deleteMany({ where: { market: MARKET, scope: "live", periodDays: 30 } });
    const res = await scout(A.token, A.storeId, "?period=30");
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ status: "no_data", topSellers: [], window: null });
    await scoutService.refresh({ onlyTenantIds: created.tenantIds, scopes: ["live"] });
  }, 60_000);
});

describe("a page load", () => {
  it("reads the saved snapshot: no AI call and no recalculation", async () => {
    const before = await prismaUnscoped.productScoutSnapshot.findMany({ where: { market: MARKET }, select: { id: true, computedAt: true } });
    const calls = aiCalls.length;
    for (let i = 0; i < 3; i++) await scout(A.token, A.storeId);
    expect(aiCalls.length).toBe(calls);
    const after = await prismaUnscoped.productScoutSnapshot.findMany({ where: { market: MARKET }, select: { id: true, computedAt: true } });
    expect(after).toEqual(before);
  });
});

describe("who may see it", () => {
  it("the owner and a Manager may; a Cashier, another store's owner and nobody signed in may not", async () => {
    expect((await scout(managerToken, A.storeId)).status).toBe(200);
    expect((await scout(cashierToken, A.storeId)).status).toBe(403);
    expect((await scout(other.token, A.storeId)).status).toBe(403);
    expect((await api("GET", `/stores/${A.storeId}/product-scout`)).status).toBe(401);
  });

  it("refuses an unknown period", async () => {
    expect((await scout(A.token, A.storeId, "?period=14")).status).toBe(400);
  });

  it("the refresh is for platform administrators only", async () => {
    expect((await api("POST", "/platform/product-scout/refresh", { token: A.token })).status).toBe(403);
  });
});

describe("opting out of shared trends", () => {
  const sharing = (token: string | undefined, storeId: string, body?: unknown) => api(body === undefined ? "GET" : "PUT", `/stores/${storeId}/trend-sharing`, { token, body });

  it("is on by default, and only the owner may see or change it", async () => {
    expect((await sharing(A.token, A.storeId)).json).toEqual({ shareSalesInTrends: true });
    expect((await sharing(managerToken, A.storeId)).status).toBe(403);
    expect((await sharing(managerToken, A.storeId, { shareSalesInTrends: false })).status).toBe(403);
    expect((await sharing(cashierToken, A.storeId, { shareSalesInTrends: false })).status).toBe(403);
    expect((await sharing(other.token, A.storeId, { shareSalesInTrends: false })).status).toBe(403);
    expect((await sharing(undefined, A.storeId)).status).toBe(401);
    expect((await sharing(A.token, A.storeId, { shareSalesInTrends: "no" })).status).toBe(400);
    expect((await sharing(A.token, A.storeId, {})).status).toBe(400);
    expect((await sharing(A.token, A.storeId)).json).toEqual({ shareSalesInTrends: true });
  });

  it("an opted-out shop's sales leave Product Scout from the next run, and it still sees the trends", async () => {
    expect((await sharing(C.token, C.storeId, { shareSalesInTrends: false })).json).toEqual({ shareSalesInTrends: false });
    // Nothing changes until the next run.
    expect((await scout(A.token, A.storeId)).json.topSellers.map((p: { name: string }) => p.name)).toContain("Copper kettle");

    await scoutService.refresh({ onlyTenantIds: created.tenantIds, scopes: ["live"] });
    // Without C the kettle comes from 2 shops: hidden, never shown with C's part taken off.
    const forA = await scout(A.token, A.storeId);
    expect(JSON.stringify(forA.json)).not.toMatch(/Copper kettle/i);
    // C still sees the shared trends, the same as everyone else.
    const forC = await scout(C.token, C.storeId);
    expect(forC.status).toBe(200);
    expect(forC.json).toMatchObject({ status: "ready", market: MARKET });
    expect(forC.json.topSellers).toEqual(forA.json.topSellers);

    expect((await sharing(C.token, C.storeId, { shareSalesInTrends: true })).json).toEqual({ shareSalesInTrends: true });
    await scoutService.refresh({ onlyTenantIds: created.tenantIds, scopes: ["live"] });
    expect((await scout(A.token, A.storeId)).json.topSellers.find((p: { name: string }) => p.name === "Copper kettle")).toMatchObject({ units: 12, stores: 3 });
  }, 120_000);

  it("and Trend Scout's", async () => {
    const { trendsService } = await import("../../src/modules/trends/trends.service");
    // The week that holds C's kettle order of yesterday, whatever day this runs on.
    const now = new Date(Date.now() + 6 * DAY_MS);
    const run = () => trendsService.runWeek(now, { tenantIds: [C.storeId], markets: [MARKET], categories: ["kitchen"] });
    // Trend Scout counts paid orders only: give that order its card payment.
    const kettleOrder = await prismaUnscoped.order.findFirstOrThrow({ where: { tenantId: C.storeId, status: "FULFILLED" } });
    const payment = await prismaUnscoped.payment.create({ data: { tenantId: C.storeId, orderId: kettleOrder.id, amount: kettleOrder.total, currency: MARKET, status: "SUCCEEDED" } });
    try {
      expect((await run()).reports).toBe(1);
      await prismaUnscoped.trendReport.deleteMany({ where: { market: MARKET, id: { notIn: created.trendReportIds } } });
      await sharing(C.token, C.storeId, { shareSalesInTrends: false });
      expect((await run()).reports).toBe(0);
    } finally {
      await sharing(C.token, C.storeId, { shareSalesInTrends: true });
      await prismaUnscoped.payment.delete({ where: { id: payment.id } });
      await prismaUnscoped.trendReport.deleteMany({ where: { market: MARKET, id: { notIn: created.trendReportIds } } });
    }
  }, 60_000);
});

describe("demo stores stay apart", () => {
  it("their 300 kettles are not in the real figures", async () => {
    const kettle = (await scout(A.token, A.storeId)).json.topSellers.find((p: { name: string }) => p.name === "Copper kettle");
    expect(kettle.units).toBe(12);
  });

  it("a demo store sees the demo stores' figures only, marked as demo", async () => {
    const res = await scout(demos[0].token, demos[0].storeId);
    expect(res.json.demo).toBe(true);
    expect(res.json.topSellers).toEqual([expect.objectContaining({ name: "Copper kettle", units: 300, stores: 3 })]);
  });

  it("Trend Scout leaves them out", async () => {
    const { trendsService } = await import("../../src/modules/trends/trends.service");
    const outcome = await trendsService.runWeek(new Date(), { tenantIds: demos.map((d) => d.storeId), markets: [MARKET] });
    expect(outcome.published).toBe(0);
    const reports = await prismaUnscoped.trendReport.findMany({ where: { market: MARKET, storeCount: { gt: 0 } } });
    expect(reports).toEqual([]);
    await prismaUnscoped.trendReport.deleteMany({ where: { market: MARKET, id: { notIn: created.trendReportIds } } });
  }, 60_000);

  it("the shop directory never lists them", async () => {
    const res = await api("GET", "/stores?limit=100");
    expect(JSON.stringify(res.json)).not.toContain("demo-scout-verify");
  });

  it("nobody can register a store with the demo prefix", async () => {
    const res = await api("POST", "/auth/register", {
      body: { email: `verify-scout-sneaky-${suffix}@example.com`, password: "password123", storeName: "Sneaky", storeSlug: `demo-scout-sneaky-${suffix}` },
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.json)).toMatch(/reserved/);
  });
});
