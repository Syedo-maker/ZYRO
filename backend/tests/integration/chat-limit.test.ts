/**
 * The shopping assistant's rate limits with limiting switched on (audit 2026-11, finding: chat limiter
 * keyed on a self-chosen guest id). The per-shopper limit keys on the guest session id, which a caller
 * picks freely, so a fresh id per message used to escape it and drain the store's chat allowance. A
 * per-address limit now sits behind it. Fake AI provider; throwaway store; a private Redis prefix.
 */
process.env.RATE_LIMIT_ENABLED = "true";
process.env.RATE_LIMIT_PREFIX = `rl-chat-test-${Date.now().toString(36)}:`;
process.env.RATE_LIMIT_CHAT_MAX = "2";
process.env.RATE_LIMIT_CHAT_IP_MAX = "4";
process.env.RATE_LIMIT_API_MAX = "1000";
process.env.RATE_LIMIT_REGISTER_MAX = "100";
process.env.AI_QUEUE_NAME = `ai-generate-verify-chatlimit-${Date.now().toString(36)}`;
process.env.AI_CACHE_SECONDS = "0";

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let storeId: string;
let userId: string;
const suffix = Date.now().toString(36);

const chat = (guest: string) =>
  request(app)
    .post(`/api/v1/stores/${storeId}/assistant/chat`)
    .set("Content-Type", "application/json")
    .set("X-Guest-Session-Id", guest)
    .send({ conversationId: `conv-${guest}`, message: "Do you have chai cups?" });

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  await (await import("../../src/lib/mongo")).connectMongo();
  (await import("../../src/lib/aiProvider")).setAiProvider({
    async generate(p) {
      return { text: "We have clay chai cups.", model: p.model, inputTokens: 10, outputTokens: 5 };
    },
  });
  (await import("../../src/lib/aiQueue")).startAiWorker();
  const reg = await request(app)
    .post("/api/v1/auth/register")
    .send({ email: `verify-chatlimit-${suffix}@example.com`, password: "password123", storeName: "Verify Chat Limit", storeSlug: `verify-chatlimit-${suffix}` });
  userId = reg.body.user.id;
  storeId = (await request(app).get("/api/v1/users/me/stores").set("Authorization", `Bearer ${reg.body.accessToken}`)).body[0].id;
}, 120_000);

afterAll(async () => {
  await prismaUnscoped.tenant.deleteMany({ where: { id: storeId } });
  await prismaUnscoped.user.deleteMany({ where: { id: userId } });
  const redis = (await import("../../src/lib/redis")).getRedis();
  const keys = await redis.keys(`${process.env.RATE_LIMIT_PREFIX}*`);
  if (keys.length) await redis.del(...keys);
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

it("one shopper is still held to the per-shopper limit", async () => {
  const guest = `guestone${suffix}aaaaaaaa`;
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await chat(guest)).status);
  expect(statuses).toEqual([200, 200, 429]);
});

it("a fresh guest id on every message no longer escapes: the address limit stops it", async () => {
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await chat(`guestrot${suffix}${i}bbbbbbbb`)).status);
  // The address already spent 3 of its 4 above (two answered, one refused by the shopper limit).
  expect(statuses[0]).toBe(200);
  expect(statuses.slice(1).every((s) => s === 429)).toBe(true);
});
