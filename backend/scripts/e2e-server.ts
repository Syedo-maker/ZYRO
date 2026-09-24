/**
 * A backend for browser tests: the real API with Stripe's network calls faked and a
 * few test-only routes. Signature verification still uses the real Stripe SDK with a
 * known test secret, so a test can deliver signed webhooks like Stripe would.
 *
 *   /__fake-stripe/:id     stands in for Stripe's hosted payment page
 *   POST /__e2e/set-tax    { storeId, rate }  sets a store's tax rate
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
  const real = getStripeGateway();
  let counter = 0;
  setStripeGateway({
    ...real,
    async createCheckoutSession() {
      const id = `cs_test_e2e_${Date.now()}_${++counter}`;
      return { id, url: `http://localhost:${port}/__fake-stripe/${id}` };
    },
    async refundPaymentIntent(_pi, key) {
      return { id: `re_${key}` };
    },
  });

  // Stands in for the Anthropic API (Phase 4's AI Orchestrator): no key, no network call, no
  // cost, but a reply shaped for whichever AI Content Tool asked (Phase 4 Module 6), so the
  // admin UI's parsing of a structured reply is exercised for real, not skipped.
  let aiCallCount = 0;
  setAiProvider({
    async generate({ system }) {
      aiCallCount++;
      const text = /Category:.*Tags:/s.test(system)
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

  const outer = express();
  outer.get("/__fake-stripe/:id", (req, res) => {
    res.type("html").send(`<title>Fake Stripe</title><h1>Fake Stripe checkout</h1><p>${req.params.id}</p>`);
  });
  outer.post("/__e2e/set-tax", express.json(), async (req, res) => {
    await prismaUnscoped.tenant.update({ where: { id: req.body.storeId }, data: { taxRate: String(req.body.rate) } });
    res.json({ ok: true });
  });
  outer.use(app);

  outer.listen(port, () => console.log(`E2E API listening on http://localhost:${port}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
