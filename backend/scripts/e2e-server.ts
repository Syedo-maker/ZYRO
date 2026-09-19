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
process.env.STRIPE_SECRET_KEY = "sk_test_e2e";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_e2e_secret";

import express from "express";

async function main() {
  const { app } = await import("../src/app");
  const { connectMongo } = await import("../src/lib/mongo");
  const { prismaUnscoped } = await import("../src/lib/prisma");
  const { getStripeGateway, setStripeGateway } = await import("../src/lib/stripe");

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
