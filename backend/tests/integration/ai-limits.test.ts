/**
 * AI cost protection (lib/aiLimits.ts): the kill switch, a daily cap per store and one for the whole
 * platform, on top of each store's monthly allowance. A stand-in provider counts real calls.
 */
process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_QUEUE_NAME = `ai-generate-limits-${Date.now().toString(36)}`;

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let generate: typeof import("../../src/modules/ai/ai.orchestrator").generate;
let tenantContext: typeof import("../../src/lib/tenantContext").tenantContext;
let getRedis: typeof import("../../src/lib/redis").getRedis;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };
let calls = 0;
let failNext = false;
let A: string;
let B: string;

async function store(tag: string) {
  const reg = await request(app).post("/api/v1/auth/register").send({ email: `verify-ailim-${tag}-${suffix}@example.com`, password: "password123", storeName: `Verify AI limits ${tag}`, storeSlug: `verify-ailim-${tag}-${suffix}` });
  const stores = await request(app).get("/api/v1/users/me/stores").set("Authorization", `Bearer ${reg.body.accessToken}`);
  created.tenantIds.push(stores.body[0].id);
  created.userIds.push(reg.body.user.id);
  return stores.body[0].id as string;
}

const ask = (tenantId: string, prompt: string, extra: { cache?: boolean } = {}) =>
  tenantContext.run(tenantId, () => generate({ tenantId, promptType: "auto_tag", system: "Tag it.", prompt, ...extra }));
const reason = (p: Promise<unknown>) => p.then(() => "ok", (e: { detail?: string }) => e.detail ?? String(e));

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ generate } = await import("../../src/modules/ai/ai.orchestrator"));
  ({ tenantContext } = await import("../../src/lib/tenantContext"));
  ({ getRedis } = await import("../../src/lib/redis"));
  (await import("../../src/lib/aiProvider")).setAiProvider({
    async generate() {
      calls++;
      if (failNext) {
        failNext = false;
        const { AiProviderError } = await import("../../src/lib/aiErrors");
        throw new AiProviderError("fake", 400, "bad request");
      }
      return { text: `answer ${calls}`, model: "fake", inputTokens: 1, outputTokens: 1 };
    },
  });
  (await import("../../src/lib/aiQueue")).startAiWorker();
  A = await store("a");
  B = await store("b");
}, 120_000);

afterEach(async () => {
  delete process.env.AI_DISABLED;
  delete process.env.AI_DAILY_STORE_LIMIT;
  delete process.env.AI_DAILY_GLOBAL_LIMIT;
  const keys = await getRedis().keys("ai:daily:*");
  if (keys.length) await getRedis().del(...keys);
});

afterAll(async () => {
  (await import("../../src/lib/aiProvider")).setAiProvider(undefined);
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  await (await import("../../src/lib/redis")).closeRedis();
  await prismaUnscoped.$disconnect();
});

it("the kill switch turns every AI feature off at once, without calling the provider", async () => {
  process.env.AI_DISABLED = "true";
  const before = calls;
  expect(await reason(ask(A, "k1"))).toMatch(/switched off/);
  expect(calls).toBe(before);
});

it("a store's daily cap stops that store only; another store carries on", async () => {
  process.env.AI_DAILY_STORE_LIMIT = "2";
  expect(await reason(ask(A, "s1"))).toBe("ok");
  expect(await reason(ask(A, "s2"))).toBe("ok");
  const before = calls;
  expect(await reason(ask(A, "s3"))).toMatch(/today's AI limit/);
  expect(calls).toBe(before);
  expect(await reason(ask(B, "s4"))).toBe("ok");
});

it("a failed call gives its place back, and a cached answer is not counted", async () => {
  process.env.AI_DAILY_STORE_LIMIT = "1";
  failNext = true;
  expect(await reason(ask(A, "f1"))).not.toBe("ok"); // failed: the count goes back
  expect(await reason(ask(A, `c1-${suffix}`, { cache: true }))).toBe("ok"); // the one allowed call
  expect(await reason(ask(A, `c1-${suffix}`, { cache: true }))).toBe("ok"); // the same again, from the cache
  expect(await reason(ask(A, "f2"))).toMatch(/today's AI limit/);
});

it("the platform's daily cap applies across stores", async () => {
  process.env.AI_DAILY_GLOBAL_LIMIT = "2";
  expect(await reason(ask(A, "g1"))).toBe("ok");
  expect(await reason(ask(B, "g2"))).toBe("ok");
  expect(await reason(ask(B, "g3"))).toMatch(/temporarily unavailable/);
});
