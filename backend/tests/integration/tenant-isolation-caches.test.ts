/**
 * Production readiness, STEP 1: one store never sees another store's cached data. The database
 * queries are scoped by tenant everywhere (tenant-scope and isolation suites); this checks the layer
 * beside them, Redis, where a key without the store in it would quietly share data:
 *
 *   - the AI answer cache: the same request from two stores is two AI calls, two separate answers
 *   - carts: one guest id in two stores is two carts
 *   - search: a product of store B is never found from store A, before or after A's results are cached
 */
process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_QUEUE_NAME = `ai-generate-iso-${Date.now().toString(36)}`;

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let Product: typeof import("../../src/models/Product.model").Product;
let generate: typeof import("../../src/modules/ai/ai.orchestrator").generate;
let tenantContext: typeof import("../../src/lib/tenantContext").tenantContext;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };
const calls: string[] = [];

async function api(method: string, path: string, opts: { token?: string; guest?: string; body?: unknown } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${path}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  if (opts.guest) req = req.set("X-Guest-Session-Id", opts.guest);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

async function owner(tag: string) {
  const reg = await api("POST", "/auth/register", { body: { email: `verify-iso-${tag}-${suffix}@example.com`, password: "password123", storeName: `Verify iso ${tag}`, storeSlug: `verify-iso-${tag}-${suffix}` } });
  if (reg.status !== 201) throw new Error(`register ${tag}: ${reg.status}`);
  const storeId = (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id as string;
  created.tenantIds.push(storeId);
  created.userIds.push(reg.json.user.id);
  return { token: reg.json.accessToken as string, storeId };
}

let A: Awaited<ReturnType<typeof owner>>;
let B: Awaited<ReturnType<typeof owner>>;

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ Product } = await import("../../src/models/Product.model"));
  ({ generate } = await import("../../src/modules/ai/ai.orchestrator"));
  ({ tenantContext } = await import("../../src/lib/tenantContext"));
  await (await import("../../src/lib/mongo")).connectMongo();
  (await import("../../src/lib/aiProvider")).setAiProvider({
    async generate(p) {
      calls.push(p.prompt);
      return { text: `answer ${calls.length}`, model: "fake-iso", inputTokens: 5, outputTokens: 5 };
    },
  });
  (await import("../../src/lib/aiQueue")).startAiWorker();
  A = await owner("a");
  B = await owner("b");
}, 120_000);

afterAll(async () => {
  (await import("../../src/lib/aiProvider")).setAiProvider(undefined);
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

it("the AI answer cache is per store: the same request from two stores is two calls and two answers", async () => {
  const input = { promptType: "auto_tag", system: "Tag this product.", prompt: `Blue mug ${suffix}`, cache: true };
  // Inside each store's request context, as a real request runs.
  const ask = (storeId: string) => tenantContext.run(storeId, () => generate({ ...input, tenantId: storeId }));
  const a1 = await ask(A.storeId);
  const a2 = await ask(A.storeId);
  const b1 = await ask(B.storeId);
  expect(a2.text).toBe(a1.text); // A's repeat came from A's cache
  expect(b1.text).not.toBe(a1.text); // B did not get A's cached answer
  expect(calls).toHaveLength(2);
});

it("one guest id in two stores has two separate carts", async () => {
  const pa = (await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: `Iso cup A ${suffix}`, price: 100, stock: 5, category: "kitchen" } })).json.id;
  const guest = `guest-iso-${suffix}`;
  expect((await api("POST", `/stores/${A.storeId}/cart/items`, { guest, body: { productId: pa, quantity: 2 } })).status).toBe(200);
  const cartB = await api("GET", `/stores/${B.storeId}/cart`, { guest });
  expect(cartB.status).toBe(200);
  expect(cartB.json.items).toEqual([]);
  // And A's product cannot be put in B's cart.
  expect((await api("POST", `/stores/${B.storeId}/cart/items`, { guest, body: { productId: pa, quantity: 1 } })).status).toBe(404);
});

it("search never returns another store's product, before or after results are cached", async () => {
  const word = `zebrawood${suffix}`;
  await api("POST", `/stores/${B.storeId}/products`, { token: B.token, body: { title: `${word} bowl`, price: 300, stock: 3, category: "kitchen" } });
  for (let i = 0; i < 2; i++) {
    const fromA = await api("GET", `/stores/${A.storeId}/products?q=${word}`);
    expect(fromA.status).toBe(200);
    expect(JSON.stringify(fromA.json)).not.toContain(word);
  }
  const fromB = await api("GET", `/stores/${B.storeId}/products?q=${word}`);
  expect(JSON.stringify(fromB.json)).toContain(word);
});
