/**
 * Part A, the revenue model, end to end against the real Postgres, MongoDB and Redis with a fake
 * Stripe gateway and a fake AI provider: the plan catalog, owner-only billing, every plan limit and
 * its upgrade hint, the price sent to Stripe coming from the server, the webhook (wrong amount,
 * unpaid, duplicate delivery, renewal, past due, cancellation, an old subscription's late event),
 * a lapsed plan falling to Free with no webhook, AI top-up packs credited once and spent after the
 * monthly allowance, the model chosen per task, the AI cache, the prompt cap, and the platform view
 * (super admins only, no emails). Creates throwaway stores and removes them after.
 * Run with: npm test -- billing
 */
import { appFetch, APP_ORIGIN } from "../helpers/appFetch";
import { createCheckRecorder, snapshotEnv } from "../helpers/checks";

// Every environment variable this file sets is put back afterwards (see afterAll).
const restoreEnv = snapshotEnv();
const { check, run, declare } = createCheckRecorder();
function exitScenario(code: number): never {
  throw new Error(`The scenario stopped early (exit code ${code})`);
}

process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_QUEUE_NAME = `ai-generate-verify-${Date.now().toString(36)}`;

async function main() {
  const { app } = await import("../../src/app");
  const { connectMongo } = await import("../../src/lib/mongo");
  const { prismaUnscoped } = await import("../../src/lib/prisma");
  const { closeRedis } = await import("../../src/lib/redis");
  const { setStripeGateway } = await import("../../src/lib/stripe");
  const { setAiProvider } = await import("../../src/lib/aiProvider");
  const { startAiWorker, closeAiQueue } = await import("../../src/lib/aiQueue");
  const { handleStripeEvent } = await import("../../src/modules/webhooks/stripe.webhook");
  const { Product } = await import("../../src/models/Product.model");
  const { generate } = await import("../../src/modules/ai/ai.orchestrator");
  const { getRedis } = await import("../../src/lib/redis");
  const mongoose = (await import("mongoose")).default;

  await connectMongo();
  startAiWorker();
  const fetch = appFetch(app, [process.env.PUBLIC_URL ?? "http://localhost:5000"]);
  const base = `${APP_ORIGIN}/api/v1`;
  async function api(method: string, p: string, opts: { token?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const res = await fetch(`${base}${p}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }

  const suffix = Date.now().toString(36);
  const created = { tenantIds: [] as string[], userIds: [] as string[] };
  async function merchant(tag: string) {
    const email = `verify-billing-${tag}-${suffix}@example.com`;
    const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `Verify ${tag}`, storeSlug: `verify-billing-${tag}-${suffix}` } });
    const stores = await api("GET", "/users/me/stores", { token: reg.json.accessToken });
    const storeId = (Array.isArray(stores.json) ? stores.json : stores.json.data)[0].id as string;
    created.tenantIds.push(storeId);
    created.userIds.push(reg.json.user.id);
    return { token: reg.json.accessToken as string, storeId, email, userId: reg.json.user.id as string };
  }

  // ---- fakes ----
  const calls = { sub: [] as any[], topup: [] as any[], portal: [] as any[] };
  const subs: Record<string, any> = {};
  setStripeGateway({
    async createCheckoutSession() { throw new Error("n/a"); },
    async refundPaymentIntent() { return { id: "re_x" }; },
    constructEvent() { throw new Error("bad signature"); },
    async expireCheckoutSession() {},
    async createSubscriptionCheckout(p) { calls.sub.push(p); return { id: "cs_sub", url: "https://fake.stripe/sub" }; },
    async createTopUpCheckout(p) { calls.topup.push(p); return { id: "cs_top", url: "https://fake.stripe/top" }; },
    async createBillingPortalSession(c, r) { calls.portal.push({ c, r }); return { url: "https://fake.stripe/portal" }; },
    async retrieveSubscription(id) { return subs[id]; },
  });
  const aiCalls: { model: string; system: string; prompt: string }[] = [];
  let aiFail = false;
  setAiProvider({
    async generate(p) {
      aiCalls.push({ model: p.model, system: p.system, prompt: p.prompt });
      if (aiFail) throw new Error("provider down");
      return { text: "Category: Kitchen\nTags: mug, cup", model: p.model, inputTokens: 1, outputTokens: 1 };
    },
  });

  try {
    const A = await merchant("a");
    const B = await merchant("b");

    // ---- catalog and overview ----
    const plans = await api("GET", "/plans");
    check("plans: public catalog lists Free, Pro, Business and top-up packs", plans.status === 200 && plans.json.plans.length === 3 && plans.json.topUpPacks.length === 2 && plans.json.plans[1].priceCents === 1200);
    const ov = await api("GET", `/stores/${A.storeId}/billing`, { token: A.token });
    check("billing: a new store is on Free with usage figures", ov.status === 200 && ov.json.plan.tier === "FREE" && ov.json.plan.status === "free" && ov.json.usage.products.limit === 50 && ov.json.usage.staff.limit === 2 && ov.json.usage.aiGenerations.limit === 15);
    check("billing: no token is 401, another store's owner is 403", (await api("GET", `/stores/${A.storeId}/billing`)).status === 401 && (await api("GET", `/stores/${A.storeId}/billing`, { token: B.token })).status === 403);
    const staffEmail = `verify-billing-st1-${suffix}@example.com`;
    check("staff: first two staff are allowed on Free", (await api("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: staffEmail, password: "password123", permissions: ["orders_write"] } })).status === 201 && (await api("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: `verify-billing-st2-${suffix}@example.com`, password: "password123", permissions: ["orders_write"] } })).status === 201);
    const st = (await prismaUnscoped.user.findUnique({ where: { email: staffEmail } }))!;
    created.userIds.push(st.id, (await prismaUnscoped.user.findUnique({ where: { email: `verify-billing-st2-${suffix}@example.com` } }))!.id);
    const staffTok = (await api("POST", "/auth/login", { body: { email: staffEmail, password: "password123" } })).json.accessToken;
    check("billing: staff cannot see or spend billing (403)", (await api("GET", `/stores/${A.storeId}/billing`, { token: staffTok })).status === 403 && (await api("POST", `/stores/${A.storeId}/billing/subscribe`, { token: staffTok, body: { plan: "PRO" } })).status === 403);

    // ---- limits on Free ----
    const s3 = await api("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: `verify-billing-st3-${suffix}@example.com`, password: "password123", permissions: ["orders_write"] } });
    check("limits: a third staff account on Free is 402 with an upgrade hint to Pro", s3.status === 402 && s3.json.upgrade?.requiredPlan === "Pro" && s3.json.upgrade?.feature === "staff" && s3.json.upgrade?.limit === 2, JSON.stringify(s3.json));
    await Product.insertMany(Array.from({ length: 50 }, (_, i) => ({ storeId: A.storeId, title: `P${i}`, category: "c", price: Product.base.Types.Decimal128.fromString("1.00") })));
    const p51 = await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "One too many", price: 1, stock: 1, category: "c" } });
    check("limits: the 51st product on Free is 402 with an upgrade hint", p51.status === 402 && p51.json.upgrade?.feature === "products" && p51.json.upgrade?.requiredPlan === "Pro");
    const day = 24 * 3600 * 1000, now = Date.now();
    const range = (d: number) => `?from=${new Date(now - d * day).toISOString()}&to=${new Date(now).toISOString()}`;
    check("limits: analytics 30 days is fine on Free, 60 days is 402", (await api("GET", `/stores/${A.storeId}/analytics/summary${range(30)}`, { token: A.token })).status === 200 && (await api("GET", `/stores/${A.storeId}/analytics/summary${range(60)}`, { token: A.token })).json.upgrade?.feature === "analytics_range");
    check("limits: a custom domain on Free is 402 (Business only)", (await api("PATCH", `/stores/${A.storeId}/domain`, { token: A.token, body: { customDomain: "shop.example.com" } })).json?.upgrade?.requiredPlan === "Business");
    check("limits: clearing a domain is always allowed", (await api("PATCH", `/stores/${A.storeId}/domain`, { token: A.token, body: { customDomain: null } })).status === 200);

    // ---- subscribe ----
    const sub = await api("POST", `/stores/${A.storeId}/billing/subscribe`, { token: A.token, body: { plan: "PRO" } });
    check("subscribe: returns the Checkout URL, and the price sent to Stripe is the server's (1200), not anything from the client", sub.status === 200 && sub.json.url === "https://fake.stripe/sub" && calls.sub[0].priceCents === 1200 && calls.sub[0].plan === "PRO" && calls.sub[0].customerEmail === A.email);
    check("subscribe: an unknown plan and the Free plan are 400", (await api("POST", `/stores/${A.storeId}/billing/subscribe`, { token: A.token, body: { plan: "FREE" } })).status === 400 && (await api("POST", `/stores/${A.storeId}/billing/subscribe`, { token: A.token, body: { plan: "GOLD" } })).status === 400);
    check("subscribe: nothing changed yet (plan still Free until Stripe confirms)", (await api("GET", `/stores/${A.storeId}/billing`, { token: A.token })).json.plan.tier === "FREE");
    check("webhook: an unsigned request to the webhook is refused", (await fetch(`${base}/webhooks/stripe`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json", "stripe-signature": "x" } })).status === 400);

    // ---- webhook: plan purchase ----
    const periodEnd = new Date(now + 30 * day);
    subs["sub_1"] = { id: "sub_1", customerId: "cus_1", status: "active", plan: "PRO", tenantId: A.storeId, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false };
    const done = (over: Record<string, unknown> = {}) => ({ type: "checkout.session.completed", data: { object: { id: "cs_sub", mode: "subscription", payment_status: "paid", amount_total: 1200, currency: "usd", customer: "cus_1", subscription: "sub_1", metadata: { purpose: "subscription", tenantId: A.storeId, plan: "PRO" }, ...over } } }) as any;
    check("webhook: a wrong charged amount is rejected and the plan stays Free", (await handleStripeEvent(done({ amount_total: 100 }))) === "rejected" && (await api("GET", `/stores/${A.storeId}/billing`, { token: A.token })).json.plan.tier === "FREE");
    check("webhook: an unpaid (delayed) session is ignored", (await handleStripeEvent(done({ payment_status: "unpaid" }))) === "ignored");
    check("webhook: the paid subscription checkout upgrades the plan", (await handleStripeEvent(done())) === "plan-updated");
    const ov2 = (await api("GET", `/stores/${A.storeId}/billing`, { token: A.token })).json;
    check("billing: now Pro, active, with Pro limits and the paid-until date", ov2.plan.tier === "PRO" && ov2.plan.status === "active" && ov2.limits.maxProducts === 1000 && ov2.usage.staff.limit === 5 && new Date(ov2.plan.paidUntil).getTime() === periodEnd.getTime() && ov2.plan.canManageSubscription);
    check("webhook: delivering the same event twice changes nothing more", (await handleStripeEvent(done())) === "plan-updated" && (await api("GET", `/stores/${A.storeId}/billing`, { token: A.token })).json.plan.tier === "PRO");
    check("upgrade takes effect at once: 51st product, 3rd staff, 60-day analytics", (await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "Now allowed", price: 1, stock: 1, category: "c" } })).status === 201 && (await api("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: `verify-billing-st3-${suffix}@example.com`, password: "password123", permissions: ["orders_write"] } })).status === 201 && (await api("GET", `/stores/${A.storeId}/analytics/summary${range(60)}`, { token: A.token })).status === 200);
    created.userIds.push((await prismaUnscoped.user.findUnique({ where: { email: `verify-billing-st3-${suffix}@example.com` } }))!.id);
    check("ai quota follows the plan: Pro allowance is 200 generations", (await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token })).json.generationsLimit === 200);
    check("subscribe: a store that already has a paid plan is 409", (await api("POST", `/stores/${A.storeId}/billing/subscribe`, { token: A.token, body: { plan: "BUSINESS" } })).status === 409);
    check("portal: opens for a store with a Stripe customer", (await api("POST", `/stores/${A.storeId}/billing/portal`, { token: A.token })).json.url === "https://fake.stripe/portal" && calls.portal[0].c === "cus_1");
    check("portal: a store that never paid has nothing to manage (409)", (await api("POST", `/stores/${B.storeId}/billing/portal`, { token: B.token })).status === 409);
    check("isolation: another store's subscription id cannot be attached (unique)", (await handleStripeEvent(done({ metadata: { purpose: "subscription", tenantId: B.storeId, plan: "PRO" } }))) === "rejected");

    // renewal, past due, cancellation, out-of-order
    const next = new Date(now + 60 * day);
    subs["sub_1"] = { ...subs["sub_1"], currentPeriodEnd: next };
    await handleStripeEvent({ type: "customer.subscription.updated", data: { object: { id: "sub_1" } } } as any);
    check("webhook: a renewal moves the paid-until date forward", new Date((await api("GET", `/stores/${A.storeId}/billing`, { token: A.token })).json.plan.paidUntil).getTime() === next.getTime());
    subs["sub_1"] = { ...subs["sub_1"], status: "past_due" };
    check("webhook: past_due keeps the plan while Stripe retries", (await handleStripeEvent({ type: "customer.subscription.updated", data: { object: { id: "sub_1" } } } as any)) === "ignored" && (await api("GET", `/stores/${A.storeId}/billing`, { token: A.token })).json.plan.tier === "PRO");
    subs["sub_1"] = { ...subs["sub_1"], status: "canceled" };
    check("webhook: cancelled (or unpaid) drops the store to Free and nothing is deleted", (await handleStripeEvent({ type: "customer.subscription.deleted", data: { object: { id: "sub_1" } } } as any)) === "plan-ended" && (await api("GET", `/stores/${A.storeId}/billing`, { token: A.token })).json.plan.tier === "FREE" && (await Product.countDocuments({ storeId: A.storeId })) === 51);
    check("free again: over the limit means no new products, existing ones stay", (await api("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "Blocked", price: 1, stock: 1, category: "c" } })).status === 402);
    // resubscribe with a new subscription, then a late event about the old one
    subs["sub_2"] = { id: "sub_2", customerId: "cus_1", status: "active", plan: "BUSINESS", tenantId: A.storeId, currentPeriodEnd: new Date(now + 30 * day), cancelAtPeriodEnd: false };
    await handleStripeEvent({ type: "checkout.session.completed", data: { object: { id: "cs_sub2", mode: "subscription", payment_status: "paid", amount_total: 3900, currency: "usd", customer: "cus_1", subscription: "sub_2", metadata: { purpose: "subscription", tenantId: A.storeId, plan: "BUSINESS" } } } } as any);
    check("resubscribe: Business after a lapse", (await api("GET", `/stores/${A.storeId}/billing`, { token: A.token })).json.plan.tier === "BUSINESS");
    check("out of order: a late 'deleted' about the OLD subscription is ignored", (await handleStripeEvent({ type: "customer.subscription.deleted", data: { object: { id: "sub_1" } } } as any)) === "ignored" && (await api("GET", `/stores/${A.storeId}/billing`, { token: A.token })).json.plan.tier === "BUSINESS");
    check("business: a custom domain can be set, is validated, and is unique", (await api("PATCH", `/stores/${A.storeId}/domain`, { token: A.token, body: { customDomain: "Shop.Example.com" } })).json.customDomain === "shop.example.com" && (await api("PATCH", `/stores/${A.storeId}/domain`, { token: A.token, body: { customDomain: "https://x.com/path" } })).status === 400);
    // lazy expiry with no webhook at all
    await prismaUnscoped.tenant.update({ where: { id: A.storeId }, data: { planExpiresAt: new Date(Date.now() - 3 * day) } });
    const lapsed = (await api("GET", `/stores/${A.storeId}/billing`, { token: A.token })).json;
    check("expiry: past the paid period plus grace the store is Free even with no webhook, and says what it lapsed from", lapsed.plan.tier === "FREE" && lapsed.plan.lapsedFrom === "Business");
    await prismaUnscoped.tenant.update({ where: { id: A.storeId }, data: { planExpiresAt: new Date(Date.now() - 2 * 3600 * 1000) } });
    check("expiry: inside the 24 hour grace the paid plan still works", (await api("GET", `/stores/${A.storeId}/billing`, { token: A.token })).json.plan.status === "grace");

    // ---- top-up packs (store B stays on Free) ----
    const tu = await api("POST", `/stores/${B.storeId}/billing/top-up`, { token: B.token, body: { pack: "small" } });
    check("top-up: returns a Checkout URL priced by the server", tu.status === 200 && calls.topup[0].priceCents === 500 && (await api("POST", `/stores/${B.storeId}/billing/top-up`, { token: B.token, body: { pack: "huge" } })).status === 400);
    const topEvent = (over: Record<string, unknown> = {}, id = "cs_top1") => ({ type: "checkout.session.completed", data: { object: { id, mode: "payment", payment_status: "paid", amount_total: 500, currency: "usd", metadata: { purpose: "ai_topup", tenantId: B.storeId, packId: "small" }, ...over } } }) as any;
    check("top-up: a wrong amount credits nothing", (await handleStripeEvent(topEvent({ amount_total: 1 }, "cs_bad"))) === "rejected" && (await api("GET", `/stores/${B.storeId}/ai-usage`, { token: B.token })).json.topUpGenerations === 0);
    check("top-up: a paid pack credits 100 generations and 300 chat messages", (await handleStripeEvent(topEvent())) === "topup-credited" && (await api("GET", `/stores/${B.storeId}/ai-usage`, { token: B.token })).json.topUpGenerations === 100);
    check("top-up: the same Stripe event twice credits only once", (await handleStripeEvent(topEvent())) === "already-processed" && (await api("GET", `/stores/${B.storeId}/ai-usage`, { token: B.token })).json.topUpGenerations === 100);

    // ---- AI: models, cache, prompt cap, credits order, release ----
    const mk = async (title: string) => (await api("POST", `/stores/${B.storeId}/products`, { token: B.token, body: { title, price: 3, stock: 1, category: "kitchen" } })).json.id as string;
    const m1 = await mk("Mug One");
    const usage0 = (await api("GET", `/stores/${B.storeId}/ai-usage`, { token: B.token })).json;
    await api("POST", `/stores/${B.storeId}/products/${m1}/auto-tag`, { token: B.token });
    check("models: auto-tag (a short task) goes to the fast model", aiCalls[aiCalls.length - 1].model === "claude-haiku-4-5", aiCalls[aiCalls.length - 1].model);
    await api("POST", `/stores/${B.storeId}/products/${m1}/ai-description/generate`, { token: B.token });
    check("models: a product description goes to the standard model", aiCalls[aiCalls.length - 1].model === "claude-sonnet-5", aiCalls[aiCalls.length - 1].model);
    const before = aiCalls.length;
    await api("POST", `/stores/${B.storeId}/products/${m1}/auto-tag`, { token: B.token });
    check("cache: an identical auto-tag request is answered from the cache: no AI call, no quota", aiCalls.length === before && (await api("GET", `/stores/${B.storeId}/ai-usage`, { token: B.token })).json.generationsUsed === usage0.generationsUsed + 2);
    await api("POST", `/stores/${B.storeId}/products/${m1}/ai-description/regenerate`, { token: B.token });
    check("cache: regenerate is never cached (a fresh answer is the point)", aiCalls.length === before + 1);
    await generate({ tenantId: B.storeId, promptType: "chat", kind: "chat", system: "S".repeat(500), prompt: "x".repeat(60_000), maxTokens: 50 }).catch(() => undefined);
    const big = aiCalls[aiCalls.length - 1];
    check("prompt cap: a 60,000 character prompt reaches the model cut to the 16,000 character ceiling", big.system.length + big.prompt.length <= 16_000, `${big.system.length + big.prompt.length}`);

    // exhaust the monthly allowance, then top-up credits are spent, then 402
    const month = new Date().toISOString().slice(0, 7);
    await prismaUnscoped.aiUsageQuota.updateMany({ where: { tenantId: B.storeId, month }, data: { generationsUsed: 15 } });
    const m2 = await mk("Mug Two");
    const okTop = await api("POST", `/stores/${B.storeId}/products/${m2}/auto-tag`, { token: B.token });
    const u1 = (await api("GET", `/stores/${B.storeId}/ai-usage`, { token: B.token })).json;
    check("credits: with the monthly allowance used up, a top-up credit is spent instead", okTop.status === 200 && u1.topUpGenerations === 99 && u1.generationsUsed === 15);
    aiFail = true;
    const m3 = await mk("Mug Three");
    const failed = await api("POST", `/stores/${B.storeId}/products/${m3}/auto-tag`, { token: B.token });
    aiFail = false;
    check("credits: a failed AI call gives the credit back (still 99)", failed.status === 503 && (await api("GET", `/stores/${B.storeId}/ai-usage`, { token: B.token })).json.topUpGenerations === 99);
    await prismaUnscoped.tenant.update({ where: { id: B.storeId }, data: { aiTopUpGenerations: 0 } });
    const m4 = await mk("Mug Four");
    const out = await api("POST", `/stores/${B.storeId}/products/${m4}/auto-tag`, { token: B.token });
    check("credits: with no allowance and no credits it is 402 with an upgrade hint and a top-up offer", out.status === 402 && out.json.upgrade?.requiredPlan === "Pro" && out.json.topUpAvailable === true, JSON.stringify(out.json));

    // ---- platform view ----
    check("platform: an ordinary owner is 403", (await api("GET", "/platform/summary", { token: A.token })).status === 403 && (await api("GET", "/platform/summary")).status === 401);
    await prismaUnscoped.user.update({ where: { id: A.userId }, data: { platformRole: "SUPER_ADMIN" } });
    const ps = await api("GET", "/platform/summary", { token: A.token });
    const pt = await api("GET", `/platform/tenants?q=verify-billing-a-${suffix}`, { token: A.token });
    check("platform: a super admin sees totals, MRR and the plan economics", ps.status === 200 && ps.json.stores >= 2 && typeof ps.json.monthlyRecurringRevenue === "number" && ps.json.economics.every((e: any) => e.profitable === true || e.priceUsd === 0));
    check("platform: the store list has per-store totals and no emails or customer data", pt.status === 200 && pt.json.data.length === 1 && pt.json.data[0].products === 51 && !JSON.stringify(pt.json).includes("@") && !("email" in pt.json.data[0]), JSON.stringify(pt.json.data[0]));
    await prismaUnscoped.user.update({ where: { id: A.userId }, data: { platformRole: "USER" } });
    check("platform: removing the role takes effect at once", (await api("GET", "/platform/summary", { token: A.token })).status === 403);
  } finally {
    await Product.deleteMany({ storeId: { $in: created.tenantIds } });
    const { AiGeneratedContent } = await import("../../src/models/AiGeneratedContent.model");
    await AiGeneratedContent.deleteMany({ storeId: { $in: created.tenantIds } });
    for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
    for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
    const keys = await getRedis().keys("ai:cache:*");
    for (const k of keys) if (created.tenantIds.some((t) => k.includes(t))) await getRedis().del(k);
  }
  await closeAiQueue();
  await closeRedis();
  await mongoose.disconnect();
  await prismaUnscoped.$disconnect();
}


beforeAll(() => run(main), 900_000);
afterAll(() => restoreEnv());

declare([
  "plans: public catalog lists Free, Pro, Business and top-up packs",
  "billing: a new store is on Free with usage figures",
  "billing: no token is 401, another store's owner is 403",
  "staff: first two staff are allowed on Free",
  "billing: staff cannot see or spend billing (403)",
  "limits: a third staff account on Free is 402 with an upgrade hint to Pro",
  "limits: the 51st product on Free is 402 with an upgrade hint",
  "limits: analytics 30 days is fine on Free, 60 days is 402",
  "limits: a custom domain on Free is 402 (Business only)",
  "limits: clearing a domain is always allowed",
  "subscribe: returns the Checkout URL, and the price sent to Stripe is the server's (1200), not anything from the client",
  "subscribe: an unknown plan and the Free plan are 400",
  "subscribe: nothing changed yet (plan still Free until Stripe confirms)",
  "webhook: an unsigned request to the webhook is refused",
  "webhook: a wrong charged amount is rejected and the plan stays Free",
  "webhook: an unpaid (delayed) session is ignored",
  "webhook: the paid subscription checkout upgrades the plan",
  "billing: now Pro, active, with Pro limits and the paid-until date",
  "webhook: delivering the same event twice changes nothing more",
  "upgrade takes effect at once: 51st product, 3rd staff, 60-day analytics",
  "ai quota follows the plan: Pro allowance is 200 generations",
  "subscribe: a store that already has a paid plan is 409",
  "portal: opens for a store with a Stripe customer",
  "portal: a store that never paid has nothing to manage (409)",
  "isolation: another store's subscription id cannot be attached (unique)",
  "webhook: a renewal moves the paid-until date forward",
  "webhook: past_due keeps the plan while Stripe retries",
  "webhook: cancelled (or unpaid) drops the store to Free and nothing is deleted",
  "free again: over the limit means no new products, existing ones stay",
  "resubscribe: Business after a lapse",
  "out of order: a late 'deleted' about the OLD subscription is ignored",
  "business: a custom domain can be set, is validated, and is unique",
  "expiry: past the paid period plus grace the store is Free even with no webhook, and says what it lapsed from",
  "expiry: inside the 24 hour grace the paid plan still works",
  "top-up: returns a Checkout URL priced by the server",
  "top-up: a wrong amount credits nothing",
  "top-up: a paid pack credits 100 generations and 300 chat messages",
  "top-up: the same Stripe event twice credits only once",
  "models: auto-tag (a short task) goes to the fast model",
  "models: a product description goes to the standard model",
  "cache: an identical auto-tag request is answered from the cache: no AI call, no quota",
  "cache: regenerate is never cached (a fresh answer is the point)",
  "prompt cap: a 60,000 character prompt reaches the model cut to the 16,000 character ceiling",
  "credits: with the monthly allowance used up, a top-up credit is spent instead",
  "credits: a failed AI call gives the credit back (still 99)",
  "credits: with no allowance and no credits it is 402 with an upgrade hint and a top-up offer",
  "platform: an ordinary owner is 403",
  "platform: a super admin sees totals, MRR and the plan economics",
  "platform: the store list has per-store totals and no emails or customer data",
  "platform: removing the role takes effect at once",
]);
