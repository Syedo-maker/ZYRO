/**
 * Phase 7's load gate: **many simultaneous AI calls never exceed the limit.**
 *
 * A quota that is checked and then incremented as two statements is a classic time-of-check to
 * time-of-use race: twenty callers can all read "14 of 15 used" before any of them writes, and all
 * twenty proceed. `reserveQuota` closes that with a single conditional
 * `UPDATE ... WHERE used < limit`, relying on Postgres holding the row lock for the whole
 * statement. That reasoning is written in the source; this file is the evidence for it.
 *
 * The test is built so that it would genuinely fail if the guard were removed: the callers are
 * fired with `Promise.all` against one row, with no staggering, and the assertions are on exact
 * counts rather than "roughly the limit".
 *
 * Both currencies of the quota are checked, because they are separate statements in the same
 * function: the monthly plan allowance, and bought top-up credits, which must never go negative.
 */
import request from "supertest";
import type { Express } from "express";
import { createCheckRecorder, snapshotEnv } from "../helpers/checks";

const restoreEnv = snapshotEnv();

process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_CACHE_SECONDS = "0";
process.env.AI_QUEUE_NAME = `ai-generate-verify-quota-${Date.now().toString(36)}`;

const { check, run, declare } = createCheckRecorder();

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };

/** How many callers pile onto one quota row at once. Comfortably more than any limit under test. */
const STAMPEDE = 60;

async function api(method: string, path: string, opts: { body?: unknown; token?: string } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${path}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  await (await import("../../src/lib/mongo")).connectMongo();
  const { setAiProvider } = await import("../../src/lib/aiProvider");
  const { startAiWorker } = await import("../../src/lib/aiQueue");
  const { reserveQuota, getOrCreateQuota, currentMonth } = await import("../../src/modules/ai/ai.quota.service");
  const { tenantContext } = await import("../../src/lib/tenantContext");
  startAiWorker();

  setAiProvider({
    async generate() {
      return { text: "A short description.", model: "fake-model-1", inputTokens: 10, outputTokens: 5 };
    },
  });

  await run(async () => {
    async function merchant(tag: string) {
      const email = `verify-quota-${tag}-${suffix}@example.com`;
      const reg = await api("POST", "/auth/register", {
        body: { email, password: "password123", storeName: `Verify Quota ${tag}`, storeSlug: `verify-quota-${tag}-${suffix}`, currency: "PKR" },
      });
      if (reg.status !== 201) throw new Error(`register ${tag}: ${reg.status} ${JSON.stringify(reg.json)}`);
      const token = reg.json.accessToken as string;
      const storeId = (await api("GET", "/users/me/stores", { token })).json[0].id as string;
      created.tenantIds.push(storeId);
      created.userIds.push(reg.json.user.id);
      return { token, storeId };
    }

    // ---- The monthly plan allowance, hammered directly ------------------------------------------

    const a = await merchant("plan");
    const quota = await tenantContext.run(a.storeId, () => getOrCreateQuota(a.storeId));
    const limit = quota.generationsLimit;
    check("the store starts with a real allowance and none of it used", limit > 0 && quota.generationsUsed === 0, `limit ${limit}`);

    // Every caller fired at once at a single row. No staggering, no awaiting between them.
    const grants = await Promise.all(
      Array.from({ length: STAMPEDE }, () => tenantContext.run(a.storeId, () => reserveQuota(a.storeId, "generation")))
    );
    const granted = grants.filter((g) => g !== null).length;
    const refused = grants.filter((g) => g === null).length;

    check(
      `exactly the allowance is granted when ${STAMPEDE} callers race for ${limit}`,
      granted === limit,
      `granted ${granted}, expected ${limit}`
    );
    check("and everybody else is refused, rather than quietly let through", refused === STAMPEDE - limit, `refused ${refused}`);

    const afterRace = await prismaUnscoped.aiUsageQuota.findFirst({ where: { tenantId: a.storeId, month: currentMonth() } });
    check("the counter lands exactly on the limit, never past it", afterRace?.generationsUsed === limit, `used ${afterRace?.generationsUsed} of ${limit}`);
    check("the counter never exceeded the limit at any point, since it cannot come back down", (afterRace?.generationsUsed ?? 0) <= limit);

    // A second stampede against an already-full quota must grant nothing at all.
    const secondRound = await Promise.all(
      Array.from({ length: 20 }, () => tenantContext.run(a.storeId, () => reserveQuota(a.storeId, "generation")))
    );
    check("a stampede against a spent allowance grants nothing", secondRound.every((g) => g === null));

    // ---- Top-up credits, which must never go negative ---------------------------------------------

    const TOPUP = 5;
    await prismaUnscoped.tenant.update({ where: { id: a.storeId }, data: { aiTopUpGenerations: TOPUP } });
    const topUpGrants = await Promise.all(
      Array.from({ length: STAMPEDE }, () => tenantContext.run(a.storeId, () => reserveQuota(a.storeId, "generation")))
    );
    const fromTopUp = topUpGrants.filter((g) => g === "topup").length;
    const balance = (await prismaUnscoped.tenant.findFirst({ where: { id: a.storeId }, select: { aiTopUpGenerations: true } }))?.aiTopUpGenerations;

    check(`exactly the ${TOPUP} bought credits are spent, not more`, fromTopUp === TOPUP, `spent ${fromTopUp}`);
    check("the credit balance lands on zero and never goes negative", balance === 0, `balance ${balance}`);
    check("no plan unit was invented to cover the overflow", topUpGrants.filter((g) => g === "plan").length === 0);

    // ---- Chat messages are a separate counter ------------------------------------------------------

    const b = await merchant("chat");
    const chatQuota = await tenantContext.run(b.storeId, () => getOrCreateQuota(b.storeId));
    const chatLimit = chatQuota.chatMessagesLimit;
    const chatGrants = await Promise.all(
      Array.from({ length: chatLimit + 25 }, () => tenantContext.run(b.storeId, () => reserveQuota(b.storeId, "chat")))
    );
    check(`exactly the chat allowance is granted when ${chatLimit + 25} callers race for ${chatLimit}`, chatGrants.filter((g) => g !== null).length === chatLimit, `granted ${chatGrants.filter((g) => g !== null).length} of ${chatLimit}`);

    const chatRow = await prismaUnscoped.aiUsageQuota.findFirst({ where: { tenantId: b.storeId, month: currentMonth() } });
    check("spending chat messages left the generation counter untouched", chatRow?.generationsUsed === 0, `generations ${chatRow?.generationsUsed}`);
    check("and the chat counter landed exactly on its own limit", chatRow?.chatMessagesUsed === chatLimit);

    // ---- One store's stampede cannot touch another store -------------------------------------------

    const c = await merchant("bystander");
    const bystanderBefore = await tenantContext.run(c.storeId, () => getOrCreateQuota(c.storeId));
    await Promise.all(Array.from({ length: 30 }, () => tenantContext.run(b.storeId, () => reserveQuota(b.storeId, "generation"))));
    const bystanderAfter = await prismaUnscoped.aiUsageQuota.findFirst({ where: { tenantId: c.storeId, month: currentMonth() } });
    check(
      "a neighbouring store's allowance is untouched by someone else's stampede",
      bystanderAfter?.generationsUsed === bystanderBefore.generationsUsed,
      `${bystanderBefore.generationsUsed} -> ${bystanderAfter?.generationsUsed}`
    );

    // ---- The same thing over real HTTP, through the queue and the orchestrator ----------------------

    const d = await merchant("http");
    const httpLimit = (await tenantContext.run(d.storeId, () => getOrCreateQuota(d.storeId))).generationsLimit;
    const attempts = httpLimit + 10;

    const responses = await Promise.all(
      Array.from({ length: attempts }, (_, i) =>
        api("POST", `/stores/${d.storeId}/product-ideas`, { token: d.token, body: { title: `concurrent probe ${i}`, category: "clothing" } })
      )
    );
    const ok = responses.filter((r) => r.status === 200).length;
    const paymentRequired = responses.filter((r) => r.status === 402).length;
    const other = responses.filter((r) => r.status !== 200 && r.status !== 402);

    /*
     * The assertion here is "never more than the allowance", not "exactly the allowance".
     *
     * The direct `reserveQuota` race above already pins the exact number, and that is where the
     * guard actually lives. This pass exists to show the same invariant surviving the whole stack:
     * HTTP, the orchestrator, and the BullMQ queue. The queue is a real constraint, though. Firing
     * every request at once can leave some jobs waiting longer than the orchestrator's patience, and
     * those come back 503. That is the system shedding load rather than failing, and on a busy
     * machine it is the honest outcome, so demanding an exact count here would make the suite flaky
     * about something that is not the thing under test.
     *
     * What must hold regardless: nobody is served beyond the allowance, and every success is paid
     * for. Both are asserted.
     */
    check(
      `over HTTP, ${attempts} simultaneous requests against an allowance of ${httpLimit} never exceed it`,
      ok <= httpLimit && ok > 0,
      `200s: ${ok}, 402s: ${paymentRequired}, other: ${other.map((r) => r.status).join(",") || "none"}`
    );
    check(
      "no request is refused with a crash: everything that did not succeed is a 402 or the queue shedding load with 503",
      other.every((r) => r.status === 503),
      other.map((r) => r.status).join(",") || "none"
    );

    const httpRow = await prismaUnscoped.aiUsageQuota.findFirst({ where: { tenantId: d.storeId, month: currentMonth() } });
    check(
      "every success was paid for, and nothing was charged for a request that did not succeed",
      httpRow?.generationsUsed === ok,
      `counter ${httpRow?.generationsUsed}, succeeded ${ok}`
    );
    check("and the counter never passed the allowance", (httpRow?.generationsUsed ?? 0) <= httpLimit, `used ${httpRow?.generationsUsed} of ${httpLimit}`);

    const refusal = responses.find((r) => r.status === 402);
    check("the refusal tells the merchant what would help", typeof refusal?.json?.detail === "string" && refusal.json.detail.length > 0, JSON.stringify(refusal?.json).slice(0, 160));
  });
}, 300_000);

afterAll(async () => {
  restoreEnv();
  (await import("../../src/lib/aiProvider")).setAiProvider(undefined);
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

declare([
  "the store starts with a real allowance and none of it used",
  /^exactly the allowance is granted when/,
  "and everybody else is refused, rather than quietly let through",
  "the counter lands exactly on the limit, never past it",
  "the counter never exceeded the limit at any point, since it cannot come back down",
  "a stampede against a spent allowance grants nothing",
  /^exactly the \d+ bought credits are spent/,
  "the credit balance lands on zero and never goes negative",
  "no plan unit was invented to cover the overflow",
  /^exactly the chat allowance is granted when/,
  "spending chat messages left the generation counter untouched",
  "and the chat counter landed exactly on its own limit",
  "a neighbouring store's allowance is untouched by someone else's stampede",
  /^over HTTP, \d+ simultaneous requests/,
  "no request is refused with a crash: everything that did not succeed is a 402 or the queue shedding load with 503",
  "every success was paid for, and nothing was charged for a request that did not succeed",
  "and the counter never passed the allowance",
  "the refusal tells the merchant what would help",
]);
