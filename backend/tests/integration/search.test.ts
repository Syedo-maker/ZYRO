/**
 * Part F, search, end to end on real MongoDB, Postgres and Redis. What the gate asks for:
 * keyword search works with no AI key and no quota, results never cross stores, and semantic search
 * returns nothing outside the store and falls back to keyword search when the service is down.
 *
 * The AI provider is deliberately set to one that throws on every call: if any search path reached
 * a model, these tests would fail rather than quietly work. Nothing here ever asserts on the key
 * itself, because a failing assertion prints what it received.
 */
process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_QUEUE_NAME = `ai-generate-verify-search-${Date.now().toString(36)}`;

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let Product: typeof import("../../src/models/Product.model").Product;
let setRecommendationClient: typeof import("../../src/lib/recommendationClient").setRecommendationClient;
let forgetVocabulary: typeof import("../../src/modules/search/search.service").forgetVocabulary;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };
let aiCalls = 0;
/** What the fake recommendation service answers, as product ids. Null means "service is down". */
let semanticAnswer: string[] | null = [];

async function api(method: string, p: string, opts: { token?: string } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${p}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  const res = await req;
  return { status: res.status as number, json: res.body };
}

async function merchant(tag: string) {
  const email = `verify-search-${tag}-${suffix}@example.com`;
  const reg = await api("POST", `/auth/register`).catch(() => null);
  void reg;
  const made = await (request(app) as any)
    .post("/api/v1/auth/register")
    .set("Content-Type", "application/json")
    .send(JSON.stringify({ email, password: "password123", storeName: `Verify Search ${tag}`, storeSlug: `verify-search-${tag}-${suffix}` }));
  const token = made.body.accessToken as string;
  const stores = await api("GET", "/users/me/stores", { token });
  const storeId = stores.json[0].id as string;
  created.tenantIds.push(storeId);
  created.userIds.push(made.body.user.id);
  return { token, storeId };
}

const add = async (o: { token: string; storeId: string }, title: string, category: string, description = "") =>
  (
    await (request(app) as any)
      .post(`/api/v1/stores/${o.storeId}/products`)
      .set("Content-Type", "application/json")
      .set("Authorization", `Bearer ${o.token}`)
      .send(JSON.stringify({ title, category, description, price: 100, stock: 5 }))
  ).body.id as string;

let A: Awaited<ReturnType<typeof merchant>>;
let B: Awaited<ReturnType<typeof merchant>>;
let flask: string;

const S = (q: string, storeId?: string) => api("GET", `/stores/${storeId ?? A.storeId}/products?q=${encodeURIComponent(q)}`);
const titles = (r: { json: { data: { title: string }[] } }) => r.json.data.map((d) => d.title);

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ Product } = await import("../../src/models/Product.model"));
  ({ setRecommendationClient } = await import("../../src/lib/recommendationClient"));
  ({ forgetVocabulary } = await import("../../src/modules/search/search.service"));
  await (await import("../../src/lib/mongo")).connectMongo();

  // Any AI call at all is a failure here, not a fallback: search must never need one.
  (await import("../../src/lib/aiProvider")).setAiProvider({
    async generate() {
      aiCalls++;
      throw new Error("search must never call the AI");
    },
  });
  setRecommendationClient({
    async recommend() {
      return null;
    },
    async search(storeId, _query, limit) {
      if (semanticAnswer === null) throw new Error("recommendation service unreachable");
      // The real service only ever returns this store's products; the fake does the same, and the
      // cross-store test below proves the backend re-checks rather than trusting it.
      void storeId;
      return semanticAnswer.slice(0, limit).map((productId, i) => ({ productId, score: 1 - i * 0.01 }));
    },
    async embedProduct() {},
  });

  A = await merchant("a");
  B = await merchant("b");
  await add(A, "Ceramic Mug", "kitchen", "A sturdy mug for everyday tea.");
  await add(A, "Steel Kettle", "kitchen", "Boils water quickly.");
  await add(A, "Clay Chai Cup", "kitchen", "Traditional cup.");
  await add(A, "Leather Shoes", "footwear", "Formal shoes.");
  flask = await add(A, "Vacuum Flask", "kitchen", "Keeps drinks hot for twelve hours.");
  await add(B, "Ceramic Teapot", "kitchen", "Another store's teapot.");
}, 240_000);

afterAll(async () => {
  setRecommendationClient(undefined);
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

// ---------------------------------------------------------------------------------------------

describe("keyword search needs no AI at all", () => {
  it("the AI provider used here refuses every call, so any search that needed one would fail", async () => {
    // Deliberately asserted as a boolean, never by comparing the variable itself: a failing
    // assertion prints what it received, and a key must never be printed anywhere.
    const { getAiProvider } = await import("../../src/lib/aiProvider");
    await expect(getAiProvider().generate({ model: "m", system: "s", prompt: "p", maxTokens: 1 })).rejects.toThrow(/never call the AI/);
    expect(aiCalls).toBeGreaterThan(0);
    aiCalls = 0;
  });

  it("an ordinary search works, and the words typed are tried first", async () => {
    const res = await S("ceramic mug");
    expect(res.status).toBe(200);
    expect(titles(res)).toContain("Ceramic Mug");
    expect(res.json.interpretation).toBeUndefined();
  });

  it("a typo finds the product, and says what it searched for instead", async () => {
    // One word on its own: with "ceramik mug" the real word "mug" would match on its own and there
    // would be nothing to correct, which is the right behaviour but not what this is testing.
    const res = await S("ceramik");
    expect(titles(res)).toContain("Ceramic Mug");
    expect(res.json.interpretation).toMatchObject({ step: "corrected", correctedTo: "ceramic", changes: [{ from: "ceramik", to: "ceramic" }] });
  });

  it("a Roman Urdu word finds the English product, and says what else it looked for", async () => {
    const res = await S("ketli");
    expect(titles(res)).toContain("Steel Kettle");
    expect(res.json.interpretation).toMatchObject({ step: "synonym", alsoSearched: ["kettle"] });
  });

  it.each([
    ["chaye", "Clay Chai Cup"],
    ["joota", "Leather Shoes"],
    ["piyali", "Clay Chai Cup"],
  ])("'%s' finds %s", async (q, expected) => {
    expect(titles(await S(q))).toContain(expected);
  });

  it("a word the store does sell is never quietly swapped for another", async () => {
    const res = await S("kettle");
    expect(titles(res)).toContain("Steel Kettle");
    expect(res.json.interpretation).toBeUndefined();
  });

  it("not one AI call was made by any of that", () => {
    expect(aiCalls).toBe(0);
  });

  it("a store's AI allowance is untouched by searching", async () => {
    const before = (await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token })).json;
    for (const q of ["ceramik", "ketli", "chaye", "zzzz"]) await S(q);
    const after = (await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token })).json;
    expect(after.generationsUsed).toBe(before.generationsUsed);
    expect(after.chatMessagesUsed).toBe(before.chatMessagesUsed);
  });
});

describe("taking the shopper literally", () => {
  const exact = (q: string) => api("GET", `/stores/${A.storeId}/products?q=${encodeURIComponent(q)}&exact=1`);

  it("a typo is not corrected when the shopper asked for their own words", async () => {
    expect((await exact("ceramik")).json.data).toEqual([]);
    expect((await exact("ceramik")).json.interpretation).toBeUndefined();
  });

  it("Roman Urdu is not expanded either", async () => {
    expect((await exact("ketli")).json.data).toEqual([]);
  });

  it("the words themselves still work perfectly well", async () => {
    expect(titles(await exact("ceramic"))).toContain("Ceramic Mug");
  });

  it("nothing is found by meaning when taken literally", async () => {
    semanticAnswer = [flask];
    expect((await exact("insulated bottle for hiking")).json.data).toEqual([]);
    semanticAnswer = [];
  });
});

describe("search never crosses stores", () => {
  it("this store's search never returns another store's product", async () => {
    for (const q of ["ceramic", "ceramik", "teapot", "ketli"]) {
      expect(titles(await S(q))).not.toContain("Ceramic Teapot");
    }
  });

  it("the other store sees only its own, and none of this one's", async () => {
    const res = await S("ceramic", B.storeId);
    expect(titles(res)).toEqual(["Ceramic Teapot"]);
  });

  it("a typo in one store is corrected against that store's own words, not another's", async () => {
    // "teapot" exists only in store B, so store A cannot correct its way to it.
    expect(titles(await S("teapo"))).not.toContain("Ceramic Teapot");
    expect(titles(await S("teapo", B.storeId))).toContain("Ceramic Teapot");
  });

  it("suggestions never cross stores either", async () => {
    const mine = await api("GET", `/stores/${A.storeId}/products/suggest?q=cera`);
    expect(mine.json.map((s: { title: string }) => s.title)).not.toContain("Ceramic Teapot");
  });
});

describe("the ladder, rung by rung", () => {
  it("nothing anywhere is an empty page, not an error", async () => {
    semanticAnswer = [];
    const res = await S("zzzzqqq");
    expect(res.status).toBe(200);
    expect(res.json.data).toEqual([]);
    expect(res.json.pagination.total).toBe(0);
  });

  it("regex characters are plain text, never a pattern", async () => {
    const res = await S("(.*[");
    expect(res.status).toBe(200);
    expect(res.json.pagination.total).toBe(0);
  });

  it("a new product is findable by a typo straight away, not after the word list expires", async () => {
    await add(A, "Porcelain Teacup", "kitchen");
    expect(titles(await S("porcelian"))).toContain("Porcelain Teacup");
  });

  it("search still works when Redis cannot cache the store's words", async () => {
    const { getRedis } = await import("../../src/lib/redis");
    const redis = getRedis();
    const realGet = redis.get.bind(redis);
    const realSet = redis.set.bind(redis);
    (redis as unknown as { get: unknown }).get = async () => {
      throw new Error("redis is down");
    };
    (redis as unknown as { set: unknown }).set = async () => {
      throw new Error("redis is down");
    };
    try {
      expect(titles(await S("ceramik"))).toContain("Ceramic Mug");
    } finally {
      (redis as unknown as { get: unknown }).get = realGet;
      (redis as unknown as { set: unknown }).set = realSet;
    }
  });
});

describe("semantic search: the last resort, and only that", () => {
  afterEach(() => {
    semanticAnswer = [];
  });

  it("when the words find nothing, products that mean something similar are offered", async () => {
    semanticAnswer = [flask];
    const res = await S("insulated bottle for hiking");
    expect(titles(res)).toEqual(["Vacuum Flask"]);
    expect(res.json.interpretation).toMatchObject({ step: "semantic" });
  });

  it("it is never asked when the words already found something", async () => {
    let asked = false;
    setRecommendationClient({
      async recommend() {
        return null;
      },
      async search() {
        asked = true;
        return [];
      },
      async embedProduct() {},
    });
    expect(titles(await S("ceramic"))).toContain("Ceramic Mug");
    expect(asked).toBe(false);
  });

  it("with the service down, the shopper gets the keyword answer and no error", async () => {
    semanticAnswer = null;
    const good = await S("ceramic");
    expect(good.status).toBe(200);
    expect(titles(good)).toContain("Ceramic Mug");
    const none = await S("insulated bottle for hiking");
    expect(none.status).toBe(200);
    expect(none.json.data).toEqual([]);
    expect(none.json.interpretation).toBeUndefined();
  });

  it("an id from outside the store is thrown away, even if the service returns one", async () => {
    const outsider = await Product.findOne({ storeId: B.storeId }).select("_id");
    semanticAnswer = [outsider!._id.toString()];
    const res = await S("insulated bottle for hiking");
    expect(res.json.data).toEqual([]);
    expect(res.json.pagination.total).toBe(0);
  });

  it("rubbish from the service is ignored rather than crashing the search", async () => {
    semanticAnswer = ["not-an-object-id", ""];
    const res = await S("insulated bottle for hiking");
    expect(res.status).toBe(200);
    expect(res.json.data).toEqual([]);
  });

  it("the store's filters still apply to a semantic answer", async () => {
    semanticAnswer = [flask];
    const res = await api("GET", `/stores/${A.storeId}/products?q=${encodeURIComponent("insulated bottle for hiking")}&category=footwear`);
    expect(res.json.data).toEqual([]);
  });

  it("semantic search spends no AI allowance either", async () => {
    semanticAnswer = [flask];
    const before = (await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token })).json.generationsUsed;
    await S("insulated bottle for hiking");
    expect((await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token })).json.generationsUsed).toBe(before);
    expect(aiCalls).toBe(0);
  });
});

describe("suggestions as the shopper types", () => {
  it("a prefix is answered from the start of any word", async () => {
    const res = await api("GET", `/stores/${A.storeId}/products/suggest?q=cer`);
    expect(res.json.map((s: { title: string }) => s.title)).toContain("Ceramic Mug");
  });

  it("a misspelt or Roman Urdu word still suggests something instead of an empty box", async () => {
    await forgetVocabulary(A.storeId);
    const typo = await api("GET", `/stores/${A.storeId}/products/suggest?q=ceramik`);
    expect(typo.json.map((s: { title: string }) => s.title)).toContain("Ceramic Mug");
    const urdu = await api("GET", `/stores/${A.storeId}/products/suggest?q=ketli`);
    expect(urdu.json.map((s: { title: string }) => s.title)).toContain("Steel Kettle");
  });

  it("a query of only punctuation suggests nothing, rather than the whole shop", async () => {
    const res = await api("GET", `/stores/${A.storeId}/products/suggest?q=${encodeURIComponent("(.*[")}`);
    expect(res.status).toBe(200);
    expect(res.json).toEqual([]);
  });
});
