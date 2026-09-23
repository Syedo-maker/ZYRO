/**
 * End-to-end check of the AI Orchestrator (Implementation_Plan.md Phase 4): the provider
 * adapter seam, the BullMQ job queue (real Redis, a fake provider standing in for the network
 * call to Anthropic, the same pattern verify-discounts.ts uses for Stripe), and the quota
 * system, driven through generate() directly and through GET /stores/:id/ai-usage over the
 * real HTTP API. Creates throwaway stores and users and removes them after.
 * Usage: npx tsx scripts/verify-ai.ts   (Redis must be running on REDIS_URL)
 *
 * No Anthropic API key or network call is used here; see verify-ai-real.ts for the opt-in,
 * real-API check.
 */
process.env.RATE_LIMIT_ENABLED = "false";
// Tight limits so quota exhaustion can be reached in a handful of calls instead of 50.
process.env.AI_MONTHLY_GENERATIONS_LIMIT = "2";
process.env.AI_MONTHLY_CHAT_MESSAGES_LIMIT = "1";
// An isolated BullMQ queue, so this script's own fake AiProvider is what actually answers its
// jobs even if a real backend or e2e-server.ts happens to be running against the same Redis
// (see the comment on AI_QUEUE_NAME in lib/aiQueue.ts).
process.env.AI_QUEUE_NAME = `ai-generate-verify-${Date.now().toString(36)}`;

import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
}

async function main() {
  const { app } = await import("../src/app");
  const { connectMongo } = await import("../src/lib/mongo");
  const { prismaUnscoped } = await import("../src/lib/prisma");
  const { closeRedis } = await import("../src/lib/redis");
  const { tenantContext } = await import("../src/lib/tenantContext");
  const { setAiProvider } = await import("../src/lib/aiProvider");
  const { startAiWorker, closeAiQueue } = await import("../src/lib/aiQueue");
  const { generate } = await import("../src/modules/ai/ai.orchestrator");
  const { getOrCreateQuota, currentMonth } = await import("../src/modules/ai/ai.quota.service");

  await connectMongo();
  startAiWorker();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const res = await fetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }

  const suffix = Date.now().toString(36);
  const created = { tenantIds: [] as string[], userIds: [] as string[] };
  async function merchant(tag: string) {
    const email = `verify-ai-${tag}-${suffix}@example.com`;
    const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `Verify ${tag}`, storeSlug: `verify-ai-${tag}-${suffix}` } });
    const stores = await api("GET", "/users/me/stores", { token: reg.json.accessToken });
    const storeId = (Array.isArray(stores.json) ? stores.json : stores.json.data)[0].id as string;
    created.tenantIds.push(storeId);
    created.userIds.push(reg.json.user.id);
    return { email, token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string };
  }

  // Records every call the orchestrator's worker makes and lets a test make the next one fail,
  // exactly like verify-discounts.ts's recording fake for Stripe.
  const calls: { system: string; prompt: string; maxTokens: number }[] = [];
  // The orchestrator retries a job up to 3 times (ai.orchestrator.ts), so making a call "fail"
  // for good means failing every attempt, not just the first.
  let remainingFailures = 0;
  setAiProvider({
    async generate(params) {
      calls.push(params);
      if (remainingFailures > 0) {
        remainingFailures--;
        throw new Error("fake provider failure (deliberate, for the verify script)");
      }
      return { text: `Generated: ${params.prompt.slice(0, 40)}`, model: "fake-model-1", inputTokens: 12, outputTokens: 6 };
    },
  });

  try {
    const A = await merchant("a");
    const B = await merchant("b");
    const staffNoPerm = { email: `verify-ai-staff-${suffix}@example.com`, password: "password123" };
    await api("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: staffNoPerm.email, password: staffNoPerm.password, permissions: ["orders_write"] } });
    const staffToken = (await api("POST", "/auth/login", { body: { email: staffNoPerm.email, password: staffNoPerm.password } })).json.accessToken as string;

    // ---- Quota is created lazily, with the tenant's default limits ----
    const usage0 = await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token });
    check(
      "ai-usage: the current month's row is created on first read, with the configured defaults (2 generations, 1 chat message)",
      usage0.status === 200 && usage0.json.month === currentMonth() && usage0.json.generationsUsed === 0 && usage0.json.generationsLimit === 2 && usage0.json.chatMessagesUsed === 0 && usage0.json.chatMessagesLimit === 1,
      JSON.stringify(usage0.json)
    );
    check("ai-usage: no token is 401, and staff without products_write is 403", (await api("GET", `/stores/${A.storeId}/ai-usage`)).status === 401 && (await api("GET", `/stores/${A.storeId}/ai-usage`, { token: staffToken })).status === 403);

    // ---- A generation round-trips through the real BullMQ queue and Redis ----
    const r1 = await tenantContext.run(A.storeId, () => generate({ tenantId: A.storeId, promptType: "product_description", system: "You write short product descriptions.", prompt: "Ceramic Mug, $12.50, kitchen" }));
    check("generate: the job runs on the real queue/worker and returns the fake provider's text and model", r1.text.startsWith("Generated:") && r1.model === "fake-model-1" && calls.length === 1);
    check("generate: what was enqueued matches what was asked for (system and prompt reach the provider unchanged)", calls[0].system === "You write short product descriptions." && calls[0].prompt === "Ceramic Mug, $12.50, kitchen" && calls[0].maxTokens === 1024);
    const usage1 = await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token });
    check("generate: a successful generation increments generationsUsed, and only that counter", usage1.json.generationsUsed === 1 && usage1.json.chatMessagesUsed === 0);

    // ---- A failed generation costs nothing ----
    remainingFailures = 3; // exhaust every retry the orchestrator allows
    let failedAsExpected = false;
    let failureStatus = 0;
    try {
      await tenantContext.run(A.storeId, () => generate({ tenantId: A.storeId, promptType: "product_description", system: "s", prompt: "p" }));
    } catch (err) {
      failedAsExpected = true;
      failureStatus = (err as { status?: number }).status ?? 0;
    }
    const usage2 = await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token });
    check("generate: a provider failure rejects as a 503 (the API being unable to fulfil the request, not the caller's fault)", failedAsExpected && failureStatus === 503);
    check("generate: a failed generation does NOT increment quota (still 1, not 2)", usage2.json.generationsUsed === 1);

    // ---- Quota exhaustion: checked before enqueueing, so a refused call never reaches the provider ----
    await tenantContext.run(A.storeId, () => generate({ tenantId: A.storeId, promptType: "product_description", system: "s", prompt: "p2" }));
    const callsBeforeExhausted = calls.length;
    let exhaustedStatus = 0;
    try {
      await tenantContext.run(A.storeId, () => generate({ tenantId: A.storeId, promptType: "product_description", system: "s", prompt: "p3" }));
    } catch (err) {
      exhaustedStatus = (err as { status?: number }).status ?? 0;
    }
    check("generate: the 3rd generation this month is refused with 402 once the limit (2) is reached", exhaustedStatus === 402);
    check("generate: quota is checked BEFORE enqueueing, so the refused call never reaches the provider", calls.length === callsBeforeExhausted);
    const usage3 = await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token });
    check("ai-usage: reflects the limit reached (2 of 2), and the row is not re-created by a refused call", usage3.json.generationsUsed === 2);

    // ---- Chat messages are a separate counter from generations ----
    const chat1 = await tenantContext.run(A.storeId, () => generate({ tenantId: A.storeId, promptType: "chat", kind: "chat", system: "s", prompt: "Hi" }));
    check("generate: a chat-kind call succeeds and returns text", chat1.text.startsWith("Generated:"));
    const usage4 = await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token });
    check("generate: chat increments chatMessagesUsed, and leaves generationsUsed alone (still 2)", usage4.json.chatMessagesUsed === 1 && usage4.json.generationsUsed === 2);
    let chatExhausted = 0;
    try {
      await tenantContext.run(A.storeId, () => generate({ tenantId: A.storeId, promptType: "chat", kind: "chat", system: "s", prompt: "Hi again" }));
    } catch (err) {
      chatExhausted = (err as { status?: number }).status ?? 0;
    }
    check("generate: chat has its own limit (1), reached independently of the generations limit", chatExhausted === 402);

    // ---- Tenant isolation: store B's quota is untouched by everything done to store A ----
    const usageB = await api("GET", `/stores/${B.storeId}/ai-usage`, { token: B.token });
    check("ai-usage: another store starts fresh (0 used), unaffected by store A's usage or exhaustion", usageB.status === 200 && usageB.json.generationsUsed === 0 && usageB.json.chatMessagesUsed === 0);
    const rB = await tenantContext.run(B.storeId, () => generate({ tenantId: B.storeId, promptType: "product_description", system: "s", prompt: "store B's own product" }));
    check("generate: store B can still generate even though store A is exhausted (separate [tenantId, month] rows)", rB.text.startsWith("Generated:"));

    // ---- Postgres row directly, for the shape the plan specifies ----
    const rawQuota = await tenantContext.run(A.storeId, () => getOrCreateQuota(A.storeId));
    check("quota row: keyed by [tenantId, month], with generations and chat tracked separately (Implementation_Plan.md Phase 4)", rawQuota.tenantId === A.storeId && rawQuota.month === currentMonth() && rawQuota.generationsUsed === 2 && rawQuota.chatMessagesUsed === 1);
  } finally {
    for (const t of created.tenantIds) await prismaUnscoped.aiUsageQuota.deleteMany({ where: { tenantId: t } });
    for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
    for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
    server.close();
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  await closeAiQueue();
  await closeRedis();
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await prismaUnscoped.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
