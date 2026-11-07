/**
 * What an AI wait timeout does to the store's allowance (audit 2026-11, finding: a timeout refunded
 * the quota while the queued job still ran). When the waiter gives up but the worker is already calling
 * the provider, that call is real spend, so the reservation must stay; a job that never started is
 * removed from the queue and its reservation given back. A fake provider that sleeps; throwaway store.
 */
process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_JOB_TIMEOUT_MS = "300";
process.env.AI_QUEUE_NAME = `ai-generate-verify-timeout-${Date.now().toString(36)}`;
process.env.AI_CACHE_SECONDS = "0";

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let storeId: string;
let userId: string;
let providerCalls = 0;
const suffix = Date.now().toString(36);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  await (await import("../../src/lib/mongo")).connectMongo();
  (await import("../../src/lib/aiProvider")).setAiProvider({
    async generate(p) {
      if (p.prompt !== "slow") return { text: "A quick answer.", model: p.model, inputTokens: 10, outputTokens: 5 };
      providerCalls++;
      await sleep(900);
      return { text: "A slow answer.", model: p.model, inputTokens: 10, outputTokens: 5 };
    },
  });
  (await import("../../src/lib/aiQueue")).startAiWorker();
  const reg = await request(app)
    .post("/api/v1/auth/register")
    .send({ email: `verify-aitimeout-${suffix}@example.com`, password: "password123", storeName: "Verify AI Timeout", storeSlug: `verify-aitimeout-${suffix}` });
  userId = reg.body.user.id;
  storeId = (await request(app).get("/api/v1/users/me/stores").set("Authorization", `Bearer ${reg.body.accessToken}`)).body[0].id;
}, 120_000);

afterAll(async () => {
  await sleep(1500); // let the slow job finish before the queue closes
  await prismaUnscoped.tenant.deleteMany({ where: { id: storeId } });
  await prismaUnscoped.user.deleteMany({ where: { id: userId } });
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

const used = async () => {
  const { currentMonth } = await import("../../src/modules/ai/ai.quota.service");
  return (await prismaUnscoped.aiUsageQuota.findFirst({ where: { tenantId: storeId, month: currentMonth() } }))?.generationsUsed ?? 0;
};
const ask = async (prompt: string) => {
  const { generate } = await import("../../src/modules/ai/ai.orchestrator");
  const { tenantContext } = await import("../../src/lib/tenantContext");
  return tenantContext.run(storeId, () => generate({ tenantId: storeId, promptType: "product_description", system: "s", prompt }));
};
const slow = () => ask("slow");

it("a timed-out request whose job is already running keeps its reservation, because the provider is being paid", async () => {
  await ask("warm up"); // the worker is now polling
  const before = await used();
  await expect(slow()).rejects.toThrow();
  await sleep(1200);
  expect(providerCalls).toBe(1);
  expect(await used()).toBe(before + 1);
});

it("a timed-out request whose job never started is taken off the queue and refunded", async () => {
  providerCalls = 0;
  const before = await used();
  // Four fill the worker's four slots; the fifth is still queued when its wait times out.
  const results = await Promise.allSettled([slow(), slow(), slow(), slow(), slow()]);
  expect(results.every((r) => r.status === "rejected")).toBe(true);
  await sleep(2500);
  expect(providerCalls).toBe(4);
  expect(await used()).toBe(before + 4);
});
