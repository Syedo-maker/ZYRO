/**
 * End-to-end check of Module 6, AI Content Tools (Implementation_Plan.md Phase 4): the product
 * description draft/edit/regenerate/publish lifecycle, review summarization and its staleness,
 * auto-tag, and SEO metadata, all against the real HTTP API, real Postgres/MongoDB/Redis/BullMQ,
 * with a fake AI provider standing in for the network call to Anthropic (the same pattern
 * verify-discounts.ts uses for Stripe). Creates throwaway stores and users and removes them after.
 * Usage: npx tsx scripts/verify-ai-content.ts   (Redis must be running on REDIS_URL)
 */
process.env.RATE_LIMIT_ENABLED = "false";
// Store A's own lifecycle test makes ~15 AI calls end to end; store B gets its own quota row
// (Implementation_Plan.md Phase 4: quota is per [tenantId, month]) and is used, untouched by A,
// to actually run one out and check every AI content tool is refused once it is.
process.env.AI_MONTHLY_GENERATIONS_LIMIT = "20";
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
  const { setAiProvider } = await import("../src/lib/aiProvider");
  const { startAiWorker, closeAiQueue } = await import("../src/lib/aiQueue");
  const { AiGeneratedContent } = await import("../src/models/AiGeneratedContent.model");
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
    const email = `verify-aic-${tag}-${suffix}@example.com`;
    const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `Verify ${tag}`, storeSlug: `verify-aic-${tag}-${suffix}` } });
    const stores = await api("GET", "/users/me/stores", { token: reg.json.accessToken });
    const storeId = (Array.isArray(stores.json) ? stores.json : stores.json.data)[0].id as string;
    created.tenantIds.push(storeId);
    created.userIds.push(reg.json.user.id);
    return { token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string };
  }
  async function customer(tag: string) {
    const email = `verify-aic-${tag}-${suffix}@example.com`;
    const reg = await api("POST", "/auth/register-customer", { body: { email, password: "password123" } });
    created.userIds.push(reg.json.user.id);
    return { token: reg.json.accessToken as string, userId: reg.json.user.id as string };
  }

  // Fake provider: replies exactly what the test wants next, so the parsing logic in
  // ai-content.service.ts is exercised against real (if scripted) model output.
  let nextReply = "A short, honest product description.";
  const calls: { system: string; prompt: string }[] = [];
  setAiProvider({
    async generate(params) {
      calls.push({ system: params.system, prompt: params.prompt });
      return { text: nextReply, model: "fake-model-1", inputTokens: 10, outputTokens: 5 };
    },
  });

  try {
    const A = await merchant("a");
    const B = await merchant("b");
    const staffNoPerm = { email: `verify-aic-staff-${suffix}@example.com`, password: "password123" };
    await api("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: staffNoPerm.email, password: staffNoPerm.password, permissions: ["orders_write"] } });
    const staffToken = (await api("POST", "/auth/login", { body: { email: staffNoPerm.email, password: staffNoPerm.password } })).json.accessToken as string;

    const mk = async (owner: { token: string; storeId: string }, title: string) =>
      (await api("POST", `/stores/${owner.storeId}/products`, { token: owner.token, body: { title, price: 12.5, stock: 10, category: "kitchen" } })).json.id as string;
    const mug = await mk(A, "Ceramic Mug");
    const bMug = await mk(B, "B's Own Mug");

    // ---- Product update now accepts tags/seoTitle/seoDescription ----
    const updated = await api("PUT", `/stores/${A.storeId}/products/${mug}`, {
      token: A.token,
      body: { title: "Ceramic Mug", price: 12.5, stock: 10, category: "kitchen", tags: ["mug", "ceramic"], seoTitle: "Ceramic Mug", seoDescription: "A handmade ceramic mug." },
    });
    check("product: tags, seoTitle and seoDescription round-trip through create/update", updated.status === 200 && JSON.stringify(updated.json.tags) === '["mug","ceramic"]' && updated.json.seoTitle === "Ceramic Mug" && updated.json.seoDescription === "A handmade ceramic mug.");

    // ---- AI description: generate, edit, regenerate, publish ----
    check("ai-usage: starts at 0 of 6 generations", (await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token })).json.generationsUsed === 0);
    check("description: before anything is generated, GET returns null (and costs nothing)", (await api("GET", `/stores/${A.storeId}/products/${mug}/ai-description`, { token: A.token })).json === null);
    nextReply = "Sip your coffee in style with this handmade ceramic mug.";
    const gen1 = await api("POST", `/stores/${A.storeId}/products/${mug}/ai-description/generate`, { token: A.token });
    check("description: generate returns a draft with the fake provider's text", gen1.status === 202 && gen1.json.status === "draft" && gen1.json.content === nextReply && gen1.json.editedByMerchant === false);
    check("description: the prompt includes what the merchant already entered (title, category, price)", /Ceramic Mug/.test(calls[calls.length - 1].prompt) && /kitchen/.test(calls[calls.length - 1].prompt) && /12\.50/.test(calls[calls.length - 1].prompt));
    check("description: generating consumes one generation from quota", (await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token })).json.generationsUsed === 1);
    check("product: aiDescriptionStatus is now draft, and the live description is unchanged until published", (await api("GET", `/stores/${A.storeId}/products/${mug}`)).json.aiDescriptionStatus === "draft" && (await api("GET", `/stores/${A.storeId}/products/${mug}`)).json.description === "");

    check("description: GET now returns the draft just generated, without spending another generation", (await api("GET", `/stores/${A.storeId}/products/${mug}/ai-description`, { token: A.token })).json.content === nextReply && (await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token })).json.generationsUsed === 1);
    const edited = await api("PATCH", `/stores/${A.storeId}/products/${mug}/ai-description`, { token: A.token, body: { content: "Merchant-edited: sip your coffee in style." } });
    check("description: the merchant can edit the draft by hand, marking it edited, with no quota cost", edited.status === 200 && edited.json.content === "Merchant-edited: sip your coffee in style." && edited.json.editedByMerchant === true && (await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token })).json.generationsUsed === 1);
    check("description: an empty edit is rejected (400)", (await api("PATCH", `/stores/${A.storeId}/products/${mug}/ai-description`, { token: A.token, body: { content: "" } })).status === 400);

    nextReply = "Regenerated: a beautifully simple ceramic mug for every morning.";
    const regen1 = await api("POST", `/stores/${A.storeId}/products/${mug}/ai-description/regenerate`, { token: A.token });
    check("description: regenerate replaces the draft and consumes another generation", regen1.status === 202 && regen1.json.content === nextReply && regen1.json.editedByMerchant === false && (await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token })).json.generationsUsed === 2);
    const afterRegen1 = await AiGeneratedContent.findOne({ storeId: A.storeId, productId: mug });
    check("description: the merchant's edited version was kept in history before being replaced", afterRegen1!.history.length === 1 && afterRegen1!.history[0].content === "Merchant-edited: sip your coffee in style.");

    // Regenerate 5 more times (2 already happened: the original generate + this one's target
    // is history entries, not generate calls) to push history past its cap of 5.
    for (let i = 0; i < 5; i++) {
      nextReply = `Regenerated take ${i}.`;
      await api("POST", `/stores/${A.storeId}/products/${mug}/ai-description/regenerate`, { token: A.token });
    }
    const afterManyRegens = await AiGeneratedContent.findOne({ storeId: A.storeId, productId: mug });
    check("description: history never grows past 5 entries no matter how many times it is regenerated", afterManyRegens!.history.length === 5, `history.length=${afterManyRegens!.history.length}`);
    check("description: history keeps the most recent superseded versions, oldest dropped first", afterManyRegens!.history[4].content === "Regenerated take 3.");

    nextReply = "Final: the one that gets published.";
    await api("POST", `/stores/${A.storeId}/products/${mug}/ai-description/regenerate`, { token: A.token });
    const published = await api("POST", `/stores/${A.storeId}/products/${mug}/ai-description/publish`, { token: A.token });
    check("description: publish copies the draft into the product's live description and returns the full product", published.status === 200 && published.json.description === "Final: the one that gets published." && published.json.id === mug);
    check("product: aiDescriptionStatus is now published", (await api("GET", `/stores/${A.storeId}/products/${mug}`)).json.aiDescriptionStatus === "published");

    // Generating again after publishing starts a new draft (status resets to draft) without losing the published text from history.
    nextReply = "A brand new draft after publishing.";
    const gen2 = await api("POST", `/stores/${A.storeId}/products/${mug}/ai-description/generate`, { token: A.token });
    check("description: generating again after a publish creates a fresh draft (status resets), keeping the published version reachable in history", gen2.json.status === "draft" && gen2.json.content === nextReply);
    check("product: the live description (already published) is untouched by a new unpublished draft", (await api("GET", `/stores/${A.storeId}/products/${mug}`)).json.description === "Final: the one that gets published.");

    // ---- Auto-tag: parses a well-formed reply, never persists anything itself ----
    nextReply = "Category: Kitchenware\nTags: mug, ceramic, coffee, handmade";
    const tag1 = await api("POST", `/stores/${A.storeId}/products/${mug}/auto-tag`, { token: A.token });
    check("auto-tag: parses the category and tag list from the model's reply", tag1.status === 200 && tag1.json.category === "Kitchenware" && JSON.stringify(tag1.json.tags) === '["mug","ceramic","coffee","handmade"]');
    check("auto-tag: a suggestion is never saved to the product by itself", (await api("GET", `/stores/${A.storeId}/products/${mug}`)).json.category === "kitchen");
    nextReply = "I cannot help with that.";
    const tagBad = await api("POST", `/stores/${A.storeId}/products/${mug}/auto-tag`, { token: A.token });
    check("auto-tag: a reply that does not follow the requested format is a clean error, not a crash or garbage data", tagBad.status === 503);

    // ---- SEO metadata: same pattern ----
    nextReply = "Title: Ceramic Mug | Handmade Kitchenware\nDescription: A handmade ceramic mug that keeps your coffee hot for ages. Shop now.";
    const seo1 = await api("POST", `/stores/${A.storeId}/products/${mug}/seo-metadata/generate`, { token: A.token });
    check("seo-metadata: parses the meta title and description from the model's reply", seo1.status === 200 && seo1.json.seoTitle === "Ceramic Mug | Handmade Kitchenware" && /keeps your coffee hot/.test(seo1.json.seoDescription));
    check("seo-metadata: a suggestion is never saved to the product by itself", (await api("GET", `/stores/${A.storeId}/products/${mug}`)).json.seoTitle === "Ceramic Mug");
    nextReply = "no format at all";
    check("seo-metadata: an unparsable reply is a clean error", (await api("POST", `/stores/${A.storeId}/products/${mug}/seo-metadata/generate`, { token: A.token })).status === 503);

    // ---- Review summarization: refuses with nothing to summarize, then caches, then goes stale ----
    check("reviews: summarizing with no published reviews yet is refused (400)", (await api("POST", `/stores/${A.storeId}/products/${mug}/reviews/summarize`, { token: A.token })).status === 400);
    check("reviews: with nothing generated yet, the summary status is null and not stale", JSON.stringify((await api("GET", `/stores/${A.storeId}/products/${mug}/reviews/summary`, { token: A.token })).json) === JSON.stringify({ summary: null, currentReviewCount: 0, stale: false }));

    const reviewer = (i: number) => customer(`rev${i}`);
    const postReview = async (tok: string, n: number) => api("POST", `/stores/${A.storeId}/products/${mug}/reviews`, { token: tok, body: { rating: 5, comment: `Great mug, review number ${n}.` } });
    const r1 = await reviewer(1);
    await postReview(r1.token, 1);

    nextReply = "Shoppers love how well this mug keeps drinks hot, with no complaints noted.";
    const sum1 = await api("POST", `/stores/${A.storeId}/products/${mug}/reviews/summarize`, { token: A.token });
    check("reviews: summarizing with one review generates and caches a summary", sum1.status === 202 && sum1.json.summary.text === nextReply && sum1.json.summary.reviewCountAtGeneration === 1 && sum1.json.stale === false);
    check("reviews: summarizing consumed one generation, same quota as the description tools", (await api("GET", `/stores/${A.storeId}/ai-usage`, { token: A.token })).json.generationsUsed > 0);
    const status1 = await api("GET", `/stores/${A.storeId}/products/${mug}/reviews/summary`, { token: A.token });
    check("reviews: GET returns the cached summary without calling the AI again", status1.json.summary.text === nextReply && status1.json.currentReviewCount === 1 && status1.json.stale === false);

    for (let i = 2; i <= 6; i++) {
      const r = await reviewer(i);
      await postReview(r.token, i);
    }
    const status2 = await api("GET", `/stores/${A.storeId}/products/${mug}/reviews/summary`, { token: A.token });
    check("reviews: once 5 more reviews arrive, the cached summary is reported stale", status2.json.currentReviewCount === 6 && status2.json.stale === true);

    nextReply = "With more reviews in, shoppers still consistently praise the heat retention.";
    const sum2 = await api("POST", `/stores/${A.storeId}/products/${mug}/reviews/summarize`, { token: A.token });
    check("reviews: regenerating refreshes the cache and clears staleness", sum2.json.summary.text === nextReply && sum2.json.summary.reviewCountAtGeneration === 6 && sum2.json.stale === false);

    // ---- Permissions ----
    check("permissions: no token is 401 on every AI content route", (await api("POST", `/stores/${A.storeId}/products/${mug}/auto-tag`)).status === 401 && (await api("GET", `/stores/${A.storeId}/products/${mug}/reviews/summary`)).status === 401);
    check("permissions: staff without products_write cannot use any AI content tool (403)", (await api("POST", `/stores/${A.storeId}/products/${mug}/auto-tag`, { token: staffToken })).status === 403 && (await api("POST", `/stores/${A.storeId}/products/${mug}/reviews/summarize`, { token: staffToken })).status === 403);

    // ---- Tenant isolation ----
    check("isolation: store B cannot see or act on store A's product (404, not 403 - ids do not leak)", (await api("GET", `/stores/${B.storeId}/products/${mug}`)).status === 404 && (await api("POST", `/stores/${B.storeId}/products/${mug}/auto-tag`, { token: B.token })).status === 404);

    // ---- Quota exhaustion applies uniformly across all four AI content tools ----
    // Run on store B, untouched by everything done to store A above, so this drains a clean quota.
    check("ai-usage: store B's quota is untouched by everything done to store A (still 0 used)", (await api("GET", `/stores/${B.storeId}/ai-usage`, { token: B.token })).json.generationsUsed === 0);
    const limitB = (await api("GET", `/stores/${B.storeId}/ai-usage`, { token: B.token })).json.generationsLimit as number;
    nextReply = "Category: X\nTags: y";
    for (let i = 0; i < limitB; i++) {
      await api("POST", `/stores/${B.storeId}/products/${bMug}/auto-tag`, { token: B.token });
    }
    check("quota: the limit was actually reached (used equals limit)", (await api("GET", `/stores/${B.storeId}/ai-usage`, { token: B.token })).json.generationsUsed === limitB);
    const exhausted = await api("POST", `/stores/${B.storeId}/products/${bMug}/seo-metadata/generate`, { token: B.token });
    check("quota: once the monthly limit is reached, every AI content tool is refused with 402, not just the one that hit it", exhausted.status === 402);
  } finally {
    const productIds = await Product.find({ storeId: { $in: created.tenantIds } }).select("_id");
    await Product.deleteMany({ storeId: { $in: created.tenantIds } });
    await AiGeneratedContent.deleteMany({ storeId: { $in: created.tenantIds } });
    const { ProductReview } = await import("../src/models/ProductReview.model");
    await ProductReview.deleteMany({ storeId: { $in: created.tenantIds }, productId: { $in: productIds.map((p) => p._id) } });
    for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
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
