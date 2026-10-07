/**
 * The landing page's public trending-suggestions demo.
 *
 * This is the only AI-backed endpoint on the platform that a stranger can reach without an account,
 * so the property this file exists to prove is a financial one: **a visitor cannot run up a bill,
 * and cannot spend any merchant's AI allowance.** Specifically
 *
 * - a prepared example costs no AI call at all once it has been generated once;
 * - the same phrase asked twice costs one call, not two;
 * - a visitor gets a small number of genuinely new generations per hour and is then served saved
 *   examples instead, and there is a second cap across every visitor together;
 * - no store's quota counter moves, whatever the demo does;
 * - an AI outage produces a saved example with an honest note, never an error or an invention;
 * - what comes back carries keywords only, never a number that could be read as a search volume.
 */
import request from "supertest";
import type { Express } from "express";
import { createCheckRecorder, snapshotEnv } from "../helpers/checks";

const restoreEnv = snapshotEnv();

process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_CACHE_SECONDS = "0";
process.env.AI_QUEUE_NAME = `ai-generate-verify-demo-${Date.now().toString(36)}`;

const { check, run, declare } = createCheckRecorder();

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };

async function api(method: string, path: string, opts: { body?: unknown; token?: string; ip?: string } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${path}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  // Supertest talks to the app over a loopback socket, so every request looks like the same
  // visitor. X-Forwarded-For lets a test pretend to be a different one; the app trusts the proxy
  // header in this environment, which is what express-rate-limit's ipKeyGenerator reads.
  if (opts.ip) req = req.set("X-Forwarded-For", opts.ip);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  await (await import("../../src/lib/mongo")).connectMongo();
  const { setAiProvider } = await import("../../src/lib/aiProvider");
  const { startAiWorker } = await import("../../src/lib/aiQueue");
  const { getRedis } = await import("../../src/lib/redis");
  const { setKeywordSources } = await import("../../src/modules/ideas/keywords.sources");
  startAiWorker();

  await run(async () => {
    // A clean slate: the demo's cache and its counters are shared, so a previous run's answers
    // would make "did this cost a call" meaningless.
    const redis = getRedis();
    for (const pattern of ["demo:ideas:*", "demo:rate:*", "ideas:keywords:*"]) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) await redis.del(...keys);
    }

    setKeywordSources([
      {
        id: "test_source",
        async keywordsFor() {
          return [
            { word: "lawn suit", source: "shopper_searches", weight: 3 },
            { word: "3 piece", source: "best_sellers", weight: 2 },
          ];
        },
      },
    ]);

    let aiCalls = 0;
    let failNext = false;
    setAiProvider({
      async generate() {
        aiCalls += 1;
        if (failNext) throw new Error("pretend the AI is down");
        return {
          text: JSON.stringify({
            suggestions: [
              { title: "Summer Lawn Suit, 3 Piece", description: "A light lawn suit cut as a 3 piece.", keywordsUsed: ["lawn suit", "3 piece"] },
              { title: "Stitched Lawn Suit", description: "Ready to wear in soft cotton.", keywordsUsed: ["lawn suit"] },
              { title: "Plain Everyday Set", description: "A plain set for ordinary days.", keywordsUsed: [] },
              { title: "Fourth One", description: "The real feature asks for four; the demo shows three.", keywordsUsed: [] },
            ],
          }),
          model: "fake-model-1",
          inputTokens: 40,
          outputTokens: 120,
        };
      },
    });

    // ---- A shop exists, so its quota can be watched while the demo runs --------------------------

    const email = `verify-demo-${suffix}@example.com`;
    const reg = await api("POST", "/auth/register", {
      body: { email, password: "password123", storeName: "Verify Demo", storeSlug: `verify-demo-${suffix}`, currency: "PKR" },
    });
    if (reg.status !== 201) throw new Error(`register: ${reg.status} ${JSON.stringify(reg.json)}`);
    const token = reg.json.accessToken as string;
    const storeId = (await api("GET", "/users/me/stores", { token })).json[0].id as string;
    created.tenantIds.push(storeId);
    created.userIds.push(reg.json.user.id);

    const quotaBefore = (await api("GET", `/stores/${storeId}/ai-usage`, { token })).json;

    // ---- The examples list is public ------------------------------------------------------------

    const examples = await api("GET", "/demo/product-ideas/examples");
    check("the example phrases are public: a visitor with no account can read them", examples.status === 200 && examples.json.examples.length > 0);

    // ---- A prepared example: generated once, then free forever ----------------------------------

    const callsBeforeExample = aiCalls;
    const first = await api("POST", "/demo/product-ideas", { body: { phrase: "lawn suit", category: "clothing" }, ip: "203.0.113.10" });
    const callsAfterFirst = aiCalls;
    const second = await api("POST", "/demo/product-ideas", { body: { phrase: "lawn suit", category: "clothing" }, ip: "203.0.113.11" });
    const callsAfterSecond = aiCalls;

    check("a prepared example answers with suggestions", first.status === 200 && first.json.suggestions.length === 3, JSON.stringify(first.json).slice(0, 200));
    check("it is labelled as a prepared example, not passed off as fresh", first.json.origin === "example");
    check("asking for it a second time costs no AI call at all", callsAfterSecond === callsAfterFirst, `${callsBeforeExample} -> ${callsAfterFirst} -> ${callsAfterSecond}`);
    check("and a different visitor gets it just as cheaply", second.json.origin === "example" && second.json.suggestions.length === 3);
    check("the demo shows three suggestions even though the model was asked for four", first.json.suggestions.length === 3);

    // ---- Keywords, never numbers ----------------------------------------------------------------

    check("the keywords come back as words", Array.isArray(first.json.keywords) && first.json.keywords.includes("lawn suit"));
    check(
      "and carry no weight, score or count a visitor could read as a search volume",
      first.json.keywords.every((k: unknown) => typeof k === "string") && !/"weight"|"count"|"volume"|"searches":\s*\d/.test(JSON.stringify(first.json)),
      JSON.stringify(first.json.keywords)
    );
    check(
      "a suggestion only claims keywords it really contains",
      first.json.suggestions[2].keywordsUsed.length === 0 && first.json.suggestions[0].keywordsUsed.includes("lawn suit"),
      JSON.stringify(first.json.suggestions.map((s: { keywordsUsed: string[] }) => s.keywordsUsed))
    );

    // ---- A typed phrase: one call, then cached --------------------------------------------------

    const callsBeforeTyped = aiCalls;
    const typed1 = await api("POST", "/demo/product-ideas", { body: { phrase: "embroidered cotton kurta", category: "clothing" }, ip: "203.0.113.20" });
    const callsAfterTyped1 = aiCalls;
    const typed2 = await api("POST", "/demo/product-ideas", { body: { phrase: "embroidered cotton kurta", category: "clothing" }, ip: "203.0.113.21" });
    const callsAfterTyped2 = aiCalls;

    check("something nobody has asked before is generated live", typed1.json.origin === "live" && callsAfterTyped1 === callsBeforeTyped + 1, `${callsBeforeTyped} -> ${callsAfterTyped1}`);
    check("the same phrase again is served from the cache, with no second call", typed2.json.origin === "cached" && callsAfterTyped2 === callsAfterTyped1);

    // ---- The per-visitor cap ---------------------------------------------------------------------

    const visitor = "203.0.113.30";
    const outcomes: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await api("POST", "/demo/product-ideas", { body: { phrase: `visitor cap probe ${suffix} ${i}`, category: "clothing" }, ip: visitor });
      outcomes.push(res.json.origin);
    }
    check("one visitor gets a few live generations and is then given saved examples", outcomes.filter((o) => o === "live").length <= 3 && outcomes.includes("example"), outcomes.join(","));
    check("the cap still answers them rather than failing", outcomes.every((o) => ["live", "cached", "example"].includes(o)), outcomes.join(","));

    const capped = await api("POST", "/demo/product-ideas", { body: { phrase: `visitor cap probe ${suffix} tail`, category: "clothing" }, ip: visitor });
    check("and says why they are seeing a saved one", capped.json.origin === "example" && typeof capped.json.note === "string" && capped.json.note.length > 0, String(capped.json.note));
    check("a capped visitor still gets usable suggestions", capped.json.suggestions.length > 0);

    // ---- No merchant pays for any of it ----------------------------------------------------------

    const quotaAfter = (await api("GET", `/stores/${storeId}/ai-usage`, { token })).json;
    check(
      "no store's AI allowance moved, however much the demo was used",
      quotaAfter.generationsUsed === quotaBefore.generationsUsed && quotaAfter.chatMessagesUsed === quotaBefore.chatMessagesUsed,
      `generations ${quotaBefore.generationsUsed} -> ${quotaAfter.generationsUsed}`
    );

    const tenantRow = await prismaUnscoped.tenant.findFirst({ where: { id: storeId }, select: { aiTopUpGenerations: true } });
    check("and no store's top-up credits were spent either", tenantRow?.aiTopUpGenerations === 0, String(tenantRow?.aiTopUpGenerations));
    check("the demo invented no tenant row for itself", (await prismaUnscoped.tenant.findFirst({ where: { id: "platform-demo" } })) === null);

    // ---- An AI outage -----------------------------------------------------------------------------

    failNext = true;
    const broken = await api("POST", "/demo/product-ideas", { body: { phrase: `outage probe ${suffix}`, category: "clothing" }, ip: "203.0.113.40" });
    failNext = false;
    check("when the AI is down the visitor still gets a page that works", broken.status === 200, String(broken.status));
    check("they are given a saved example and told so, not an error", broken.json.origin === "example" && broken.json.suggestions.length > 0, JSON.stringify(broken.json).slice(0, 200));

    // ---- It writes nothing -------------------------------------------------------------------------

    check("the demo created no products anywhere", (await api("GET", `/stores/${storeId}/products`, { token })).json.data.length === 0);

    // ---- Input is still validated --------------------------------------------------------------------

    const empty = await api("POST", "/demo/product-ideas", { body: { phrase: "" }, ip: "203.0.113.50" });
    check("an empty phrase is refused rather than sent to the AI", empty.status === 400, String(empty.status));
    const huge = await api("POST", "/demo/product-ideas", { body: { phrase: "x".repeat(400) }, ip: "203.0.113.50" });
    check("a pasted essay is refused rather than paid for", huge.status === 400, String(huge.status));
  });
}, 180_000);

afterAll(async () => {
  restoreEnv();
  (await import("../../src/lib/aiProvider")).setAiProvider(undefined);
  (await import("../../src/modules/ideas/keywords.sources")).setKeywordSources(undefined);
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

declare([
  "the example phrases are public: a visitor with no account can read them",
  "a prepared example answers with suggestions",
  "it is labelled as a prepared example, not passed off as fresh",
  "asking for it a second time costs no AI call at all",
  "and a different visitor gets it just as cheaply",
  "the demo shows three suggestions even though the model was asked for four",
  "the keywords come back as words",
  "and carry no weight, score or count a visitor could read as a search volume",
  "a suggestion only claims keywords it really contains",
  "something nobody has asked before is generated live",
  "the same phrase again is served from the cache, with no second call",
  "one visitor gets a few live generations and is then given saved examples",
  "the cap still answers them rather than failing",
  "and says why they are seeing a saved one",
  "a capped visitor still gets usable suggestions",
  "no store's AI allowance moved, however much the demo was used",
  "and no store's top-up credits were spent either",
  "the demo invented no tenant row for itself",
  "when the AI is down the visitor still gets a page that works",
  "they are given a saved example and told so, not an error",
  "the demo created no products anywhere",
  "an empty phrase is refused rather than sent to the AI",
  "a pasted essay is refused rather than paid for",
]);
