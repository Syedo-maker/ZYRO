/**
 * Part D, the Trend Scout, end to end on real Postgres, MongoDB and Redis with a fake AI provider:
 * sales from several stores become one shared, anonymised weekly report per market and category;
 * a category with too few stores is withheld; the AI is given numbered facts only and a report that
 * fails the checks is written from the facts instead; no facts means "no data" with no AI call; one
 * report per category per week; the trends source can be swapped; Google Trends files are imported by
 * platform administrators; merchants see the reports for their own categories.
 *
 * The test stores sell in "XTS" (the ISO code reserved for testing) so no real store's sales or reports
 * are ever touched, and every run is limited to the test's own stores and categories.
 */
process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_QUEUE_NAME = `ai-generate-verify-trends-${Date.now().toString(36)}`;
process.env.AI_CACHE_SECONDS = "0";

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let tenantContext: typeof import("../../src/lib/tenantContext").tenantContext;
let createOrder: typeof import("../../src/modules/commerce/order.service").createOrder;
let trendsService: typeof import("../../src/modules/trends/trends.service").trendsService;
let setTrendSources: typeof import("../../src/modules/trends/trends.sources").setTrendSources;
let weekStartOf: typeof import("../../src/modules/advisor/advisor.service").weekStartOf;
let Product: typeof import("../../src/models/Product.model").Product;

const suffix = Date.now().toString(36);
const DAY = 24 * 60 * 60 * 1000;
const created = { tenantIds: [] as string[], userIds: [] as string[] };
const aiCalls: { system: string; prompt: string; model: string }[] = [];
let aiMode: "echo" | "invent" | "down" = "echo";

async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${path}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

async function merchant(tag: string, currency?: string) {
  const email = `verify-trends-${tag}-${suffix}@example.com`;
  const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `Verify Trends ${tag}`, storeSlug: `verify-trends-${tag}-${suffix}` } });
  const storeId = (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id as string;
  created.tenantIds.push(storeId);
  created.userIds.push(reg.json.user.id);
  if (currency) await prismaUnscoped.tenant.update({ where: { id: storeId }, data: { currency } });
  return { token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string, email };
}

const product = async (owner: { token: string; storeId: string }, title: string, category: string) =>
  (await api("POST", `/stores/${owner.storeId}/products`, { token: owner.token, body: { title, price: 10, stock: 500, category } })).json.id as string;

/** A paid order placed at `at`. */
async function order(storeId: string, productId: string, quantity: number, at: Date) {
  const o = await tenantContext.run(storeId, () =>
    createOrder({ tenantId: storeId, channel: "ONLINE", guestEmail: "ayesha.customer@example.com", items: [{ productId, quantity }], payments: [{ method: "CARD", amount: 10 * quantity }] })
  );
  await prismaUnscoped.order.update({ where: { id: o.id }, data: { createdAt: at } });
}

const NOW = new Date();
let weekStart: string;
const KITCHEN = "home and kitchen";
const kitchen: Awaited<ReturnType<typeof merchant>>[] = [];
let garden: Awaited<ReturnType<typeof merchant>>;
let pk: Awaited<ReturnType<typeof merchant>>;
let admin: Awaited<ReturnType<typeof merchant>>;
const googleCategory = `trendtest ${suffix}`;
const emptyCategory = `trendtest empty ${suffix}`;
const onlyTest = () => ({ tenantIds: created.tenantIds, markets: ["XTS"] });

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ tenantContext } = await import("../../src/lib/tenantContext"));
  ({ createOrder } = await import("../../src/modules/commerce/order.service"));
  ({ trendsService } = await import("../../src/modules/trends/trends.service"));
  ({ setTrendSources } = await import("../../src/modules/trends/trends.sources"));
  ({ weekStartOf } = await import("../../src/modules/advisor/advisor.service"));
  ({ Product } = await import("../../src/models/Product.model"));
  await (await import("../../src/lib/mongo")).connectMongo();
  (await import("../../src/lib/aiProvider")).setAiProvider({
    async generate(p) {
      aiCalls.push({ system: p.system, prompt: p.prompt, model: p.model });
      if (aiMode === "down") throw new Error("provider down");
      if (aiMode === "invent") return { text: "Kitchen sales will jump 90% next month as Eid approaches. [F1]", model: p.model, inputTokens: 300, outputTokens: 30 };
      // Like a well-behaved model: each fact reworded as one line citing it.
      const lines = p.prompt.split("\n").flatMap((l) => {
        const m = /^(F\d+) \(source: .*?; date: \d{4}-\d{2}-\d{2}\): (.*)$/.exec(l);
        return m ? [`${m[2]} [${m[1]}]`] : [];
      });
      return { text: lines.join("\n") || "NO_DATA", model: p.model, inputTokens: 300, outputTokens: 60 };
    },
  });
  (await import("../../src/lib/aiQueue")).startAiWorker();

  weekStart = weekStartOf(NOW);
  // The test market may hold reports from an earlier run (or the browser test): start clean.
  await prismaUnscoped.trendReport.deleteMany({ where: { market: "XTS" } });
  const monday = Date.parse(`${weekStart}T00:00:00Z`);
  const inWeek = new Date(monday - 3 * DAY); // the week the report covers
  const before = new Date(monday - 14 * DAY); // the 4 weeks it is compared with

  // Six kitchen stores in the XTS market, typing the category two different ways. Each: 3 cups this
  // week; 4 cups and 4 kettles in the weeks before. Together: 18 this week against 12 a week before.
  for (let i = 0; i < 6; i++) {
    const s = await merchant(`k${i}`, "XTS");
    kitchen.push(s);
    const cup = await product(s, "Clay Chai Cup", i % 2 ? "Home & Kitchen" : "home and kitchen");
    const kettle = await product(s, "Steel Kettle", "HOME AND KITCHEN");
    await order(s.storeId, cup, 3, inWeek);
    await order(s.storeId, cup, 4, before);
    await order(s.storeId, kettle, 4, before);
  }
  // One garden store: too few stores for anything to be published about gardening.
  garden = await merchant("garden", "XTS");
  const hose = await product(garden, "Garden Hose", "Garden");
  await order(garden.storeId, hose, 5, inWeek);
  await order(garden.storeId, hose, 5, before);

  // A rupee store selling in the category the Google Trends file will be imported for, and an administrator.
  pk = await merchant("pk", "PKR");
  await product(pk, "Chai Kettle", googleCategory);
  admin = await merchant("admin");
  await prismaUnscoped.user.update({ where: { id: admin.userId }, data: { platformRole: "SUPER_ADMIN" } });
}, 240_000);

afterAll(async () => {
  setTrendSources(undefined);
  await prismaUnscoped.trendReport.deleteMany({ where: { OR: [{ market: "XTS" }, { category: { in: [googleCategory, emptyCategory] } }] } });
  await prismaUnscoped.trendSignalImport.deleteMany({ where: { category: { in: [googleCategory, emptyCategory] } } });
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

const report = (category: string, market = "XTS") => prismaUnscoped.trendReport.findUnique({ where: { market_category_weekStart: { market, category, weekStart } } });
const redo = async (category = KITCHEN) => {
  await prismaUnscoped.trendReport.deleteMany({ where: { market: "XTS", category, weekStart } });
  return trendsService.runWeek(NOW, onlyTest());
};

describe("the weekly run", () => {
  let callsBefore: number;
  let outcome: Awaited<ReturnType<typeof trendsService.runWeek>>;

  beforeAll(async () => {
    callsBefore = aiCalls.length;
    outcome = await trendsService.runWeek(NOW, onlyTest());
  });

  it("writes one report per market and category: kitchen published, garden withheld", () => {
    expect(outcome).toMatchObject({ weekStart, published: 1, suppressed: 1, noData: 0, failed: 0 });
  });

  it("stores typing 'Home & Kitchen', 'home and kitchen' and 'HOME AND KITCHEN' are one category", async () => {
    const r = await report(KITCHEN);
    expect(r).toMatchObject({ status: "published", source: "ai", storeCount: 6 });
  });

  it("the figures add up across stores: 18 units this week, up 50% on the weekly average of 12", async () => {
    const facts = (await report(KITCHEN))!.facts as { id: string; kind: string; text: string; source: string; date: string }[];
    expect(facts[0]).toMatchObject({ id: "F1", kind: "platform", source: "ZYRO sales across stores (anonymised)" });
    expect(facts[0].text).toMatch(/sold 18 units .* 5 or more stores, up 50% on the weekly average of the 4 weeks before \(12\)/);
    // "Clay Chai Cup": its three words move together, so they are one fact.
    expect(facts.filter((f) => /in the title/.test(f.text)).map((f) => f.text)).toEqual([expect.stringMatching(/^Products with "chai", "clay" or "cup" in the title sold 18 units .* up 200%/)]);
  });

  it("every line of the report cites facts that exist, and every fact has a source and a date", async () => {
    const r = (await report(KITCHEN))!;
    const ids = new Set((r.facts as { id: string }[]).map((f) => f.id));
    const lines = r.lines as { text: string; cites: string[] }[];
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l.cites.length > 0 && l.cites.every((c) => ids.has(c))).toBe(true);
    for (const f of r.facts as { source: string; date: string }[]) {
      expect(f.source).toBeTruthy();
      expect(f.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("the AI (paid by the platform, the better model) is given totals only: no store name, email, id or customer", () => {
    const calls = aiCalls.slice(callsBefore);
    expect(calls).toHaveLength(1); // the withheld garden category costs no AI call
    const p = calls[0].prompt;
    expect(calls[0].model).toBe(process.env.AI_MODEL_STANDARD ?? "claude-sonnet-5");
    expect(p).not.toMatch(/Verify Trends|verify-trends|@example\.com|ayesha/i);
    for (const s of [...kitchen, garden]) expect(p).not.toContain(s.storeId);
    expect(p).not.toMatch(/Garden Hose/); // a withheld category's products never reach the AI
  });

  it("a category with too few stores is withheld: no figures, no lines", async () => {
    const r = (await report("garden"))!;
    expect(r).toMatchObject({ status: "suppressed", source: "none" });
    expect(r.facts).toEqual([]);
    expect(r.lines).toEqual([]);
  });

  it("the same week again changes nothing and costs nothing: one report per category per week, shared", async () => {
    const calls = aiCalls.length;
    expect(await trendsService.runWeek(NOW, onlyTest())).toMatchObject({ published: 0, existing: 2 });
    expect(aiCalls.length).toBe(calls);
    expect(await prismaUnscoped.trendReport.count({ where: { market: "XTS", category: KITCHEN, weekStart } })).toBe(1);
  });

  it("two runs at once still leave exactly one report", async () => {
    await prismaUnscoped.trendReport.deleteMany({ where: { market: "XTS", category: KITCHEN, weekStart } });
    await Promise.all([trendsService.runWeek(NOW, onlyTest()), trendsService.runWeek(NOW, onlyTest())]);
    expect(await prismaUnscoped.trendReport.count({ where: { market: "XTS", category: KITCHEN, weekStart } })).toBe(1);
  });
});

describe("no invented trends", () => {
  afterAll(() => {
    aiMode = "echo";
  });

  it("an AI answer with a number that is not in the facts is thrown away; the report is written from the facts", async () => {
    aiMode = "invent";
    await redo();
    const r = (await report(KITCHEN))!;
    expect(r.source).toBe("template");
    expect(JSON.stringify(r.lines)).not.toMatch(/90%|next month|Eid/);
    expect((r.lines as { text: string }[]).map((l) => l.text)).toEqual((r.facts as { text: string }[]).map((f) => f.text));
  });

  it("with the AI down, the report is still written, from the facts", async () => {
    aiMode = "down";
    await redo();
    expect((await report(KITCHEN))!.source).toBe("template");
  });

  it("no facts at all means 'no data', and the AI is not asked", async () => {
    const res = await api("POST", "/platform/trends/imports", {
      token: admin.token,
      body: { market: "PKR", category: emptyCategory, csv: `Week,kettle: (Pakistan)\n${weekStart},10\n${weekStart},12\n` },
    });
    expect(res.status).toBe(201);
    // Too few readings to show a movement, so the source has no fact to give.
    await prismaUnscoped.trendSignalImport.update({ where: { id: res.json.id }, data: { periodEnd: new Date(Date.parse(weekStart) - 7 * DAY).toISOString().slice(0, 10) } });
    const calls = aiCalls.length;
    const out = await trendsService.runWeek(NOW, { tenantIds: [pk.storeId], markets: ["PKR"], categories: [emptyCategory] });
    expect(out).toMatchObject({ noData: 1, published: 0 });
    expect(aiCalls.length).toBe(calls);
    expect(await report(emptyCategory, "PKR")).toMatchObject({ status: "no_data", source: "none", lines: [], facts: [] });
  });
});

describe("the trends source can be swapped", () => {
  afterAll(() => setTrendSources(undefined));

  it("a different source's facts go into the report with its own name and date, nothing else changing", async () => {
    setTrendSources([
      {
        id: "test_source",
        async factsFor(market, category) {
          return market === "XTS" && category === KITCHEN ? [{ text: "Test Index: kitchen interest was 70 out of 100.", source: "Test Index", date: "2026-09-20" }] : [];
        },
      },
    ]);
    await redo();
    const facts = (await report(KITCHEN))!.facts as { kind: string; source: string; date: string; text: string }[];
    expect(facts.filter((f) => f.kind === "external")).toEqual([{ id: expect.any(String), kind: "external", source: "Test Index", date: "2026-09-20", text: "Test Index: kitchen interest was 70 out of 100." }]);
  });

  it("a source that fails is skipped; the report still comes from the platform's figures", async () => {
    setTrendSources([{ id: "broken", factsFor: async () => { throw new Error("offline"); } }]);
    expect(await redo()).toMatchObject({ published: 1, failed: 0 });
    expect(((await report(KITCHEN))!.facts as { kind: string }[]).every((f) => f.kind === "platform")).toBe(true);
  });
});

describe("Google Trends files (platform administrators)", () => {
  // 16 weekly readings ending the week before the report: 40 for twelve weeks, then 60.
  const monday = () => Date.parse(`${weekStart}T00:00:00Z`);
  const csv = () =>
    "Category: All categories\n\nWeek,chai kettle: (Pakistan)\n" +
    Array.from({ length: 16 }, (_, i) => `${new Date(monday() - (16 - i) * 7 * DAY).toISOString().slice(0, 10)},${i < 12 ? 40 : 60}`).join("\n");

  it("an administrator imports a file; it is read, and stored against the market and a normalised category", async () => {
    const res = await api("POST", "/platform/trends/imports", { token: admin.token, body: { market: "PKR", category: `TrendTest ${suffix}`, csv: csv(), fileName: "multiTimeline.csv" } });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ market: "PKR", category: googleCategory, geo: "Pakistan", terms: ["chai kettle"], points: 16 });
    expect((await api("GET", "/platform/trends/imports", { token: admin.token })).json.some((i: { id: string }) => i.id === res.json.id)).toBe(true);
  });

  it("a file that is not a Google Trends export, or a market that is not offered, is refused with 400", async () => {
    expect((await api("POST", "/platform/trends/imports", { token: admin.token, body: { market: "PKR", category: "x", csv: "hello,world" } })).status).toBe(400);
    expect((await api("POST", "/platform/trends/imports", { token: admin.token, body: { market: "JPY", category: "x", csv: csv() } })).status).toBe(400);
  });

  it("merchants cannot import files, list them, read every market's reports or run the job (403)", async () => {
    const m = kitchen[0].token;
    expect((await api("POST", "/platform/trends/imports", { token: m, body: { market: "PKR", category: "x", csv: csv() } })).status).toBe(403);
    expect((await api("GET", "/platform/trends/imports", { token: m })).status).toBe(403);
    expect((await api("GET", "/platform/trends", { token: m })).status).toBe(403);
    expect((await api("POST", "/platform/trends/run", { token: m })).status).toBe(403);
  });

  it("a category with no store sales can still get a report from the file alone, citing Google Trends with its dates", async () => {
    await trendsService.runWeek(NOW, { tenantIds: [pk.storeId], markets: ["PKR"], categories: [googleCategory] });
    const r = (await report(googleCategory, "PKR"))!;
    expect(r.status).toBe("published");
    const facts = r.facts as { kind: string; text: string; source: string; url?: string }[];
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ kind: "external", url: "https://trends.google.com/trends/explore?q=chai%20kettle" });
    expect(facts[0].text).toMatch(/Google Trends \(Pakistan\): search interest in "chai kettle" averaged 60 out of 100 .* up 50% on the 12 readings before \(average 40\)/);
    expect(facts[0].source).toMatch(/^Google Trends, Pakistan \(file imported /);
  });

  it("the administrator sees the week's reports for every market, with store counts", async () => {
    const res = await api("GET", "/platform/trends", { token: admin.token });
    expect(res.status).toBe(200);
    expect(res.json.weekStart).toBe(weekStart);
    expect(res.json.reports.find((r: { market: string; category: string }) => r.market === "XTS" && r.category === KITCHEN)).toMatchObject({ status: "published", storeCount: 6 });
  });
});

describe("what a merchant sees", () => {
  it("their market and their categories, each with the shared report, but never how many stores exactly", async () => {
    const res = await api("GET", `/stores/${kitchen[0].storeId}/trends`, { token: kitchen[0].token });
    expect(res.status).toBe(200);
    expect(res.json.market).toBe("XTS");
    expect(res.json.categories.map((c: { category: string }) => c.category)).toEqual([KITCHEN]);
    const r = res.json.categories[0].report;
    expect(r).toMatchObject({ status: "published", name: "Home and kitchen", weekStart });
    expect(r.covers.to).toBe(new Date(Date.parse(`${weekStart}T00:00:00Z`) - DAY).toISOString().slice(0, 10));
    expect(r).not.toHaveProperty("storeCount");
    const text = JSON.stringify(res.json);
    for (const s of kitchen.slice(1)) expect(text).not.toContain(s.storeId);
    expect(text).not.toMatch(/Verify Trends k[1-5]|@example\.com/);
  });

  it("every store in the category sees the same report", async () => {
    const a = (await api("GET", `/stores/${kitchen[0].storeId}/trends`, { token: kitchen[0].token })).json.categories[0].report.id;
    const b = (await api("GET", `/stores/${kitchen[5].storeId}/trends`, { token: kitchen[5].token })).json.categories[0].report.id;
    expect(a).toBe(b);
  });

  it("the garden store is told its category is withheld, with no figures", async () => {
    const r = (await api("GET", `/stores/${garden.storeId}/trends`, { token: garden.token })).json.categories[0].report;
    expect(r).toMatchObject({ status: "suppressed", lines: [], facts: [] });
  });

  it("the rupee store sees the Google Trends report for its category", async () => {
    const res = await api("GET", `/stores/${pk.storeId}/trends`, { token: pk.token });
    expect(res.json.market).toBe("PKR");
    expect(res.json.categories[0]).toMatchObject({ category: googleCategory, report: { status: "published" } });
  });

  it("no token is 401; staff without the analytics permission is 403; another store's owner is 403", async () => {
    const email = `verify-trends-staff-${suffix}@example.com`;
    await api("POST", `/stores/${kitchen[0].storeId}/staff`, { token: kitchen[0].token, body: { email, password: "password123", permissions: ["pos_sell"] } });
    const staff = await api("POST", "/auth/login", { body: { email, password: "password123" } });
    created.userIds.push(staff.json.user.id);
    expect((await api("GET", `/stores/${kitchen[0].storeId}/trends`)).status).toBe(401);
    expect((await api("GET", `/stores/${kitchen[0].storeId}/trends`, { token: staff.json.accessToken })).status).toBe(403);
    expect((await api("GET", `/stores/${kitchen[0].storeId}/trends`, { token: garden.token })).status).toBe(403);
  });
});
