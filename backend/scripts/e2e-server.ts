/**
 * A backend for browser tests: the real API with Stripe's network calls faked and a
 * few test-only routes. Signature verification still uses the real Stripe SDK with a
 * known test secret, so a test can deliver signed webhooks like Stripe would.
 *
 *   /__fake-stripe/:id     stands in for Stripe's hosted payment page
 *   POST /__e2e/set-tax    { storeId, rate }  sets a store's tax rate
 *   POST /__e2e/billing    { storeId, kind, plan? | pack? }  completes a fake plan or AI pack payment
 *
 * These routes exist only in this script, never in the real app.
 * Usage: npx tsx scripts/e2e-server.ts   (listens on PORT, default 5000)
 */
// Off by default because the browser tests register many users quickly; start with
// RATE_LIMIT_ENABLED=true (and a private RATE_LIMIT_PREFIX) to test the limits in the UI.
process.env.RATE_LIMIT_ENABLED ??= "false";
process.env.STRIPE_SECRET_KEY = "sk_test_e2e";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_e2e_secret";

import express from "express";

async function main() {
  const { app } = await import("../src/app");
  const { connectMongo } = await import("../src/lib/mongo");
  const { prismaUnscoped } = await import("../src/lib/prisma");
  const { getStripeGateway, setStripeGateway } = await import("../src/lib/stripe");
  const { setAiProvider } = await import("../src/lib/aiProvider");
  const { startAiWorker } = await import("../src/lib/aiQueue");

  await connectMongo();
  const port = Number(process.env.PORT ?? 5000);
  const { handleStripeEvent } = await import("../src/modules/webhooks/stripe.webhook");
  const { PLANS, findTopUpPack, BILLING_CURRENCY } = await import("../src/lib/plans");
  const real = getStripeGateway();
  let counter = 0;
  const fakeSubscriptions = new Map<string, import("../src/lib/stripe").BillingSubscription>();
  setStripeGateway({
    ...real,
    async createCheckoutSession() {
      const id = `cs_test_e2e_${Date.now()}_${++counter}`;
      return { id, url: `http://localhost:${port}/__fake-stripe/${id}` };
    },
    async refundPaymentIntent(_pi, key) {
      return { id: `re_${key}` };
    },
    // Plans and AI packs (Part A): the Checkout page is a stand-in, and POST /__e2e/billing below
    // plays Stripe's part (the webhook) once the "payment" is done.
    async createSubscriptionCheckout(p) {
      const id = `cs_test_e2e_sub_${Date.now()}_${++counter}`;
      return { id, url: `http://localhost:${port}/__fake-stripe/${id}` };
    },
    async createTopUpCheckout(p) {
      const id = `cs_test_e2e_top_${Date.now()}_${++counter}`;
      return { id, url: `http://localhost:${port}/__fake-stripe/${id}` };
    },
    async createBillingPortalSession() {
      return { url: `http://localhost:${port}/__fake-stripe/portal` };
    },
    async retrieveSubscription(id) {
      const sub = fakeSubscriptions.get(id);
      if (!sub) throw new Error(`No fake subscription ${id}`);
      return sub;
    },
  });

  // Stands in for the Anthropic API (Phase 4's AI Orchestrator): no key, no network call, no
  // cost, but a reply shaped for whichever AI Content Tool asked (Phase 4 Module 6), so the
  // admin UI's parsing of a structured reply is exercised for real, not skipped.
  let aiCallCount = 0;
  setAiProvider({
    async generate({ system, prompt }) {
      aiCallCount++;
      const offer = /Offer details from the merchant: (.+?)\.?$/m.exec(prompt)?.[1];
      const text = /promotional email/.test(system)
        ? `Subject: Fresh for the morning${offer && !/^none/.test(offer) ? `\n\nOur Ceramic Mug: ${offer}. Shop now.` : "\n\nOur Ceramic Mug is back. Shop now."}`
        : /advertising headlines/.test(system)
          ? "Sip in style\nWarm all morning\nHandmade for you"
          : /social media post/.test(system)
            ? "Start your morning right with a handmade mug.\n#coffee #handmade"
            : /Category:.*Tags:/s.test(system)
        ? "Category: Kitchenware\nTags: mug, ceramic, handmade"
        : /meta title/i.test(system)
          ? "Title: Ceramic Mug | Handmade & Dishwasher Safe\nDescription: A handmade ceramic mug that keeps drinks hot for hours. Shop the collection today."
          : /summarize customer reviews/i.test(system)
            ? "Shoppers consistently praise how well this mug retains heat, with no complaints so far."
            : /shopping assistant/i.test(system)
              ? "Yes! Based on what's in stock, I'd recommend the ones shown below."
              : `A handmade ceramic mug built for daily use (generation #${aiCallCount}).`;
      return { text, model: "fake-model-e2e", inputTokens: 10, outputTokens: 8 };
    },
  });
  startAiWorker();

  // Stands in for the Python recommendation service (Phase 6): no second process to start for a
  // browser test. "Similar" here just means same category first, then the rest, which is enough
  // to test what the UI does with the answer; the real similarity is verify-recommendations.ts's job.
  const { setRecommendationClient } = await import("../src/lib/recommendationClient");
  const { Product } = await import("../src/models/Product.model");
  setRecommendationClient({
    async recommend(storeId, productId, limit) {
      const source = await Product.findOne({ _id: productId, storeId }).select("category");
      if (!source) return null;
      const others = await Product.find({ storeId, _id: { $ne: productId } }).select("category").sort({ _id: 1 });
      const ranked = [...others.filter((p) => p.category === source.category), ...others.filter((p) => p.category !== source.category)];
      return ranked.slice(0, limit).map((p, i) => ({ productId: p._id.toString(), score: 1 - i * 0.01 }));
    },
    async search() {
      return [];
    },
    async embedProduct() {},
  });

  const outer = express();
  outer.get("/__fake-stripe/:id", (req, res) => {
    res.type("html").send(`<title>Fake Stripe</title><h1>Fake Stripe checkout</h1><p>${req.params.id}</p>`);
  });
  outer.post("/__e2e/set-tax", express.json(), async (req, res) => {
    await prismaUnscoped.tenant.update({ where: { id: req.body.storeId }, data: { taxRate: String(req.body.rate) } });
    res.json({ ok: true });
  });
  // Plays Stripe's part after a fake plan or pack payment: the same events the real webhook receives,
  // run through the real handler. { storeId, kind: "subscription", plan: "PRO" | "BUSINESS" },
  // { storeId, kind: "topup", pack: "small" | "large" } or { storeId, kind: "cancel" }.
  outer.post("/__e2e/billing", express.json(), async (req, res) => {
    const { storeId, kind, plan, pack } = req.body as { storeId: string; kind: string; plan?: "PRO" | "BUSINESS"; pack?: string };
    const subId = `sub_e2e_${storeId}`;
    let outcome: unknown;
    if (kind === "subscription" && plan) {
      fakeSubscriptions.set(subId, {
        id: subId,
        customerId: `cus_e2e_${storeId}`,
        status: "active",
        plan,
        tenantId: storeId,
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false,
      });
      outcome = await handleStripeEvent({
        type: "checkout.session.completed",
        data: { object: { id: `cs_e2e_sub_${Date.now()}`, mode: "subscription", payment_status: "paid", amount_total: PLANS[plan].priceCents, currency: BILLING_CURRENCY, customer: `cus_e2e_${storeId}`, subscription: subId, metadata: { purpose: "subscription", tenantId: storeId, plan } } },
      } as never);
    } else if (kind === "topup" && pack && findTopUpPack(pack)) {
      outcome = await handleStripeEvent({
        type: "checkout.session.completed",
        data: { object: { id: `cs_e2e_top_${Date.now()}_${++counter}`, mode: "payment", payment_status: "paid", amount_total: findTopUpPack(pack)!.priceCents, currency: BILLING_CURRENCY, metadata: { purpose: "ai_topup", tenantId: storeId, packId: pack } } },
      } as never);
    } else if (kind === "cancel" && fakeSubscriptions.has(subId)) {
      fakeSubscriptions.set(subId, { ...fakeSubscriptions.get(subId)!, status: "canceled" });
      outcome = await handleStripeEvent({ type: "customer.subscription.deleted", data: { object: { id: subId } } } as never);
    } else {
      res.status(400).json({ error: "unknown kind" });
      return;
    }
    res.json({ outcome });
  });
  outer.use(app);

  outer.listen(port, () => console.log(`E2E API listening on http://localhost:${port}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
