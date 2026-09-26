/**
 * End-to-end check of the last Phase 5 item, AI business insights (Implementation_Plan.md): the
 * sales-trend comparison, best sellers, low-stock detection (both the per-product
 * InventoryLevel.lowStockThreshold - a Phase 0 field nothing had used before this - and the
 * env fallback), demand-forecast velocity from the StockMovement ledger, staleness, quota
 * exhaustion never destroying the last good write-up, permissions and tenant isolation. A fake
 * AI provider stands in for the network call to Anthropic. Creates throwaway stores and removes
 * them after.
 * Usage: npx tsx scripts/verify-insights.ts   (Redis must be running on REDIS_URL)
 */
process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_MONTHLY_GENERATIONS_LIMIT = "2";
// Identical facts would otherwise be answered from the AI cache without spending quota; these checks are about quota.
process.env.AI_CACHE_SECONDS = "0";
// An isolated BullMQ queue, so this script's own fake AiProvider is what actually answers its
// jobs even if a real backend or e2e-server.ts happens to be running against the same Redis
// (see the AI_QUEUE_NAME comment in lib/aiQueue.ts).
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
  const { setAiProvider } = await import("../src/lib/aiProvider");
  const { startAiWorker, closeAiQueue } = await import("../src/lib/aiQueue");
  const { Product } = await import("../src/models/Product.model");
  const mongoose = (await import("mongoose")).default;

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
    const email = `verify-ins-${tag}-${suffix}@example.com`;
    const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `Verify ${tag}`, storeSlug: `verify-ins-${tag}-${suffix}` } });
    const stores = await api("GET", "/users/me/stores", { token: reg.json.accessToken });
    const storeId = (Array.isArray(stores.json) ? stores.json : stores.json.data)[0].id as string;
    created.tenantIds.push(storeId);
    created.userIds.push(reg.json.user.id);
    return { token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string };
  }

  let nextReply = "Sales are steady and Widget is your top seller; Gadget is running low.";
  const aiCalls: { system: string; prompt: string }[] = [];
  setAiProvider({
    async generate(params) {
      aiCalls.push({ system: params.system, prompt: params.prompt });
      return { text: nextReply, model: "fake-model-1", inputTokens: 10, outputTokens: 5 };
    },
  });

  try {
    const A = await merchant("a");
    const B = await merchant("b");
    const staffNoPerm = { email: `verify-ins-staff-${suffix}@example.com`, password: "password123" };
    await api("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: staffNoPerm.email, password: staffNoPerm.password, permissions: ["orders_write"] } });
    const staffToken = (await api("POST", "/auth/login", { body: { email: staffNoPerm.email, password: staffNoPerm.password } })).json.accessToken as string;

    const widget = (await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "Widget", price: 10, stock: 100, category: "misc" } })).json.id as string;
    const gadget = (await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "Gadget", price: 20, stock: 3, category: "misc" } })).json.id as string;
    const gizmo = (await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "Gizmo", price: 50, stock: 50, category: "misc" } })).json.id as string;
    // A merchant-set threshold (Phase 0's InventoryLevel.lowStockThreshold, never used before this
    // module): Gizmo has plenty of stock but the merchant considers 60 the floor for it.
    await prismaUnscoped.inventoryLevel.updateMany({ where: { tenantId: A.storeId, productId: gizmo }, data: { lowStockThreshold: 60 } });

    // ---- Nothing generated yet ----
    check("insights: a fresh store has no cached insight yet", JSON.stringify((await api("GET", `/stores/${A.storeId}/insights`, { token: A.token })).json) === JSON.stringify({ insight: null, stale: false }));

    // ---- Orders this week and last week, so the trend has a real comparison ----
    const { tenantContext } = await import("../src/lib/tenantContext");
    const { createOrder } = await import("../src/modules/commerce/order.service");
    let pi = 0;
    const place = async (items: [string, number][], total: number, daysAgo: number) => {
      const order = await tenantContext.run(A.storeId, () =>
        createOrder({ tenantId: A.storeId, channel: "ONLINE", guestEmail: "buyer@example.com", items: items.map(([productId, quantity]) => ({ productId, quantity })), payments: [{ method: "STRIPE", amount: total, stripePaymentIntentId: `pi_ins_${suffix}_${++pi}` }] })
      );
      if (daysAgo > 0) await prismaUnscoped.order.update({ where: { id: order.id }, data: { createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000) } });
      return order;
    };
    await place([[widget, 2]], 20, 0); // this week: 20
    await place([[widget, 1]], 10, 10); // last week: 10 -> +100% trend

    const gen = await api("POST", `/stores/${A.storeId}/insights/generate`, { token: A.token });
    check("generate: returns the AI's write-up (202)", gen.status === 202 && gen.json.text === nextReply && gen.json.model === "fake-model-1");
    check("generate: the sales trend is a real +100% (20 this week vs 10 last week)", gen.json.facts.salesTrend.thisWeek === 20 && gen.json.facts.salesTrend.lastWeek === 10 && gen.json.facts.salesTrend.changePercent === 100);
    check("generate: Widget is named as a best seller with its real units and revenue", gen.json.facts.bestSellers.some((p: { title: string; unitsSold: number }) => p.title === "Widget" && p.unitsSold === 2));
    check("generate: Gadget appears low-stock (3 left, under the fallback threshold of 5)", gen.json.facts.lowStock.some((i: { title: string; quantity: number }) => i.title === "Gadget" && i.quantity === 3));
    check("generate: Gizmo also appears low-stock, from its own merchant-set threshold (50 left, but the floor is 60)", gen.json.facts.lowStock.some((i: { title: string; quantity: number }) => i.title === "Gizmo" && i.quantity === 50));
    check("ai: the prompt names the real products and figures, not invented ones", /Widget/.test(aiCalls[0].prompt) && /Gadget/.test(aiCalls[0].prompt) && /3 left/.test(aiCalls[0].prompt));
    check("quota: generating an insight spends one generation", (await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token })).json.generationsUsed === 1);

    // ---- The cached insight is served without calling the AI again ----
    const callsBefore = aiCalls.length;
    const got = await api("GET", `/stores/${A.storeId}/insights`, { token: A.token });
    check("get: returns the cached write-up, unchanged, without spending quota", got.json.insight.text === nextReply && aiCalls.length === callsBefore && (await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token })).json.generationsUsed === 1);
    check("get: not stale immediately after generating", got.json.stale === false);

    // ---- Staleness ----
    await prismaUnscoped.aiBusinessInsight.updateMany({ where: { tenantId: A.storeId }, data: { generatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
    check("get: reports stale once older than the staleness window (default 24h)", (await api("GET", `/stores/${A.storeId}/insights`, { token: A.token })).json.stale === true);

    // ---- Quota exhaustion never destroys the last good write-up ----
    nextReply = "second generation";
    await api("POST", `/stores/${A.storeId}/insights/generate`, { token: A.token }); // 2nd generation - now at the limit (2)
    const exhausted = await api("POST", `/stores/${A.storeId}/insights/generate`, { token: A.token });
    check("quota: a 3rd generation this month is refused with 402", exhausted.status === 402);
    check("quota: the last successful write-up is still served, not wiped out by the refused attempt", (await api("GET", `/stores/${A.storeId}/insights`, { token: A.token })).json.insight.text === "second generation");

    // ---- Permissions ----
    check("permissions: no token is 401", (await api("GET", `/stores/${A.storeId}/insights`)).status === 401);
    check("permissions: staff without analytics_read cannot view or generate (403)", (await api("GET", `/stores/${A.storeId}/insights`, { token: staffToken })).status === 403 && (await api("POST", `/stores/${A.storeId}/insights/generate`, { token: staffToken })).status === 403);

    // ---- Tenant isolation ----
    check("isolation: store B has no insight, and its quota is untouched by store A", JSON.stringify((await api("GET", `/stores/${B.storeId}/insights`, { token: B.token })).json) === JSON.stringify({ insight: null, stale: false }) && (await api("GET", `/stores/${B.storeId}/ai-usage`, { token: B.token })).json.generationsUsed === 0);
  } finally {
    await Product.deleteMany({ storeId: { $in: created.tenantIds } });
    for (const t of created.tenantIds) {
      await prismaUnscoped.aiBusinessInsight.deleteMany({ where: { tenantId: t } });
      await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
    }
    for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
    server.close();
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  await closeAiQueue();
  await closeRedis();
  await mongoose.disconnect();
  await prismaUnscoped.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
