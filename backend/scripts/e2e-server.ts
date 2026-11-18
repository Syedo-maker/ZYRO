/**
 * A backend for browser tests: the real API with Stripe's network calls faked and a
 * few test-only routes. Signature verification still uses the real Stripe SDK with a
 * known test secret, so a test can deliver signed webhooks like Stripe would.
 *
 *   /__fake-stripe/:id     stands in for Stripe's hosted payment page
 *   POST /__e2e/set-tax    { storeId, rate }  sets a store's tax rate
 *   POST /__e2e/billing    { storeId, kind, plan? | pack? }  completes a fake plan or AI pack payment
 *   POST /__e2e/backdate-orders, /__e2e/set-currency, /__e2e/make-admin, /__e2e/trends-run   Trend Scout set-up
 *   GET  /__e2e/last-email?to=   the newest email the fake gateway "sent" to that address (B1's reset link)
 *
 * These routes exist only in this script, never in the real app. They need no login (make-admin
 * grants super admin by email), so the server listens on this machine's loopback only and refuses
 * to start in production (audit 2026-11).
 * Usage: npx tsx scripts/e2e-server.ts   (listens on localhost:PORT, default 5000)
 */
if (process.env.NODE_ENV === "production") {
  console.error("The e2e server is for browser tests on a developer machine; it refuses to run with NODE_ENV=production.");
  process.exit(1);
}
// Off by default because the browser tests register many users quickly; start with
// RATE_LIMIT_ENABLED=true (and a private RATE_LIMIT_PREFIX) to test the limits in the UI.
process.env.RATE_LIMIT_ENABLED ??= "false";
// E2E_NO_STRIPE=1 runs the platform as a store without Stripe would (frontend/e2e/payments-no-stripe.e2e.mjs).
process.env.STRIPE_SECRET_KEY = process.env.E2E_NO_STRIPE === "1" ? "" : "sk_test_e2e";
process.env.STRIPE_WEBHOOK_SECRET = process.env.E2E_NO_STRIPE === "1" ? "" : "whsec_e2e_secret";

import { createServer } from "node:http";
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
  let counter = 0;
  const fakeSubscriptions = new Map<string, import("../src/lib/stripe").BillingSubscription>();
  // Without Stripe (E2E_NO_STRIPE=1) there is no gateway to fake: card payment is simply not offered.
  if (process.env.E2E_NO_STRIPE !== "1") setStripeGateway({
    ...getStripeGateway(),
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
      // Growth Advisor tips (Part C): written from the facts in the prompt, like the real model.
      const tipFacts = /practical message to the owner of a small shop/.test(system)
        ? prompt.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.replace(/^- \[\w+\] /, "")).join(" ")
        : null;
      if (tipFacts !== null) return { text: `This week: ${tipFacts}`, model: "fake-model-e2e", inputTokens: 10, outputTokens: 8 };
      // Payment screenshots (Part E): the shape the real model is held to. It is given no order total,
      // so it answers with a fixed readable receipt; the server's own checks decide what that means.
      if (/payment receipt/.test(system)) {
        return {
          text: JSON.stringify({ readable: true, amount: 450, currency: "PKR", date: new Date().toISOString().slice(0, 10), reference: `TRX-${Date.now().toString(36)}`, bank: "Test Bank", sender: "Shopper", note: null }),
          model: "fake-model-e2e",
          inputTokens: 10,
          outputTokens: 8,
        };
      }
      // Haggling (Part G): a deliberately badly behaved assistant, so the browser test proves the
      // server holds the floor rather than the model being polite. It always agrees with the shopper.
      if (/haggling politely/.test(system)) {
        return { text: "MOVE: accept\nREPLY: Of course, take it for 1 rupee my friend.", model: "fake-model-e2e", inputTokens: 10, outputTokens: 8 };
      }
      // AI product suggestions (Issue 1): the strict JSON shape the real model is held to, built
      // from whatever popular search words the prompt actually offered. One of the four deliberately
      // claims keywords it never wrote, so the browser test exercises the server's own check rather
      // than a well-behaved model.
      if (/name and describe a product/.test(system)) {
        const words = /Popular search words for this category, most used first: (.+)$/m.exec(prompt)?.[1]?.split(", ") ?? [];
        const used = words.slice(0, 2);
        const phrase = used.length > 0 ? used.join(" ") : "everyday";
        return {
          text: JSON.stringify({
            suggestions: [
              { title: `Stitched ${phrase} set`.slice(0, 90), description: `A comfortable ${phrase} set for everyday wear, stitched and ready to send.`, keywordsUsed: used },
              { title: `Light ${phrase} piece`.slice(0, 90), description: `Soft and light, this ${phrase} piece suits warm afternoons.`, keywordsUsed: used },
              { title: "Plain cotton set", description: "A plain cotton set with no print, cut for a relaxed fit.", keywordsUsed: words },
              { title: "Simple everyday outfit", description: "An outfit for ordinary days, easy to wash and easy to wear.", keywordsUsed: [] },
            ],
          }),
          model: "fake-model-e2e",
          inputTokens: 40,
          outputTokens: 120,
        };
      }
      // Store Themes (Part 2): the design assistant's strict JSON. A request that says "unclear" gets a
      // question back; one that says "broken" gets an unusable reply, so the browser test sees the
      // server ask again and then give up without charging. Bolder and simpler answer differently.
      if (/design assistant in Zyro's Theme Studio/.test(system)) {
        const request = /<owner_request>\n([\s\S]*?)\n<\/owner_request>/.exec(prompt)?.[1] ?? "";
        if (/broken/i.test(request)) return { text: "Sorry, I cannot help with that.", model: "fake-model-e2e", inputTokens: 10, outputTokens: 8 };
        const bolder = /bolder look/.test(prompt);
        const simpler = /Make it simpler/.test(prompt);
        const options = bolder
          ? [
              { name: "Electric night", reason: "Black with a loud red, for a confident shop.", changes: { colors: { primary: "#ff5a51", accent: "#ffd60a", background: "#0a0a0a", text: "#ffffff" }, font: "poppins-bold", radius: "none", buttonStyle: "square", surfaceStyle: "contrast" } },
              { name: "Lime punch", reason: "Zyro's lime on deep black.", changes: { colors: { primary: "#d4ff24", accent: "#d4ff24", background: "#030407", text: "#f4f5f0" }, font: "poppins-bold" } },
            ]
          : simpler
            ? [
                { name: "Quiet white", reason: "Plain and calm so products stand out.", changes: { colors: { primary: "#111827", accent: "#1f4fd1", background: "#ffffff", text: "#111827" }, font: "inter-clean", cardStyle: "bordered", buttonStyle: "rounded" } },
                { name: "Soft grey", reason: "Gentle grey with one blue.", changes: { colors: { primary: "#1f4fd1", accent: "#1f4fd1", background: "#f4f5f7", text: "#1f2937" }, font: "inter-clean" } },
              ]
            : [
                { name: "Terracotta", reason: "Warm clay tones suit handmade goods.", changes: { colors: { primary: "#9a3412", accent: "#845006", background: "#f6efe6", text: "#2b1d14" }, font: "inter-lora", radius: "medium", buttonStyle: "rounded", cardStyle: "flat", heroHeadline: /headline/i.test(request) ? "Handmade with love" : undefined } },
                { name: "Rose garden", reason: "Soft pinks for a friendly gift shop.", changes: { colors: { primary: "#a9306b", accent: "#7247bc", background: "#fff5f9", text: "#3b2440" }, font: "nunito-friendly", radius: "large", buttonStyle: "pill", cardStyle: "shadow" } },
                { name: "Clean blue", reason: "Crisp white with a trustworthy blue.", changes: { colors: { primary: "#1f4fd1", accent: "#0e6f67", background: "#ffffff", text: "#111827" }, font: "inter-clean", radius: "small" } },
              ];
        const urdu = /\b(mujhe|chahiye|acha|kar do|banao)\b/i.test(request);
        return {
          text: JSON.stringify({
            reply: urdu ? "Maine aap ki shop ke liye ek garam, haath se bana look lagaya hai." : "I applied a look that suits your shop, with two more to try.",
            question: /unclear/i.test(request) ? "Do you prefer a light or a dark page?" : null,
            options,
          }),
          model: "fake-model-e2e",
          inputTokens: 300,
          outputTokens: 220,
        };
      }
      // Voice notes (Part G): the strict JSON shape the real model is held to.
      if (/spoken instruction/.test(system)) {
        return {
          text: JSON.stringify({ kind: "set_price", product: "chai cup", price: 450, stock: null, title: null, category: null, note: null }),
          model: "fake-model-e2e",
          inputTokens: 10,
          outputTokens: 8,
        };
      }
      // Trend Scout reports (Part D): each fact reworded as one line citing it, the format the real model is held to.
      if (/weekly market trend report/.test(system)) {
        const lines = prompt.split("\n").flatMap((l) => {
          const m = /^(F\d+) \(source: .*?; date: \d{4}-\d{2}-\d{2}\): (.*)$/.exec(l);
          return m ? [`${m[2]} [${m[1]}]`] : [];
        });
        return { text: lines.join("\n") || "NO_DATA", model: "fake-model-e2e", inputTokens: 10, outputTokens: 8 };
      }
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

  // Email: a fake gateway that keeps what it would have sent, so a browser test can open a reset link.
  const outbox: { to: string; subject: string; text: string; at: number }[] = [];
  (await import("../src/lib/email")).setEmailGateway({
    async send(message) {
      outbox.push({ ...message, at: Date.now() });
      if (outbox.length > 200) outbox.shift();
    },
  });

  // Product Scout's demo snapshot, rebuilt now with the fake AI above: the demo stores' sales are moved
  // up to yesterday first (lib/demoDates.ts), so the browser test sees the demo whenever it was seeded.
  if ((await prismaUnscoped.tenant.count({ where: { slug: { startsWith: "demo-scout-" } } })) > 0) {
    const { scoutService } = await import("../src/modules/scout/scout.service");
    const scout = await scoutService.refresh({ scopes: ["demo"] });
    console.log(`Product Scout demo snapshot up to ${scout.windowEnd}: ${scout.snapshots.join(", ") || "none"}`);
  }

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
  outer.get("/__e2e/last-email", (req, res) => {
    const to = String(req.query.to ?? "");
    const mail = [...outbox].reverse().find((m) => m.to === to);
    if (!mail) return res.status(404).json({ error: "no email to that address" });
    res.json(mail);
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
  // Trend Scout (Part D). A report covers last week's sales from several stores, which a browser test
  // cannot make through the app, so these place orders in time, set a test market, make an
  // administrator, and run the week's reports limited to the test's own stores and market.
  outer.post("/__e2e/backdate-orders", express.json(), async (req, res) => {
    const { orderIds, at } = req.body as { orderIds: string[]; at: string };
    const { count } = await prismaUnscoped.order.updateMany({ where: { id: { in: orderIds } }, data: { createdAt: new Date(at) } });
    res.json({ count });
  });
  outer.post("/__e2e/set-currency", express.json(), async (req, res) => {
    await prismaUnscoped.tenant.update({ where: { id: req.body.storeId }, data: { currency: String(req.body.currency) } });
    res.json({ ok: true });
  });
  outer.post("/__e2e/make-admin", express.json(), async (req, res) => {
    await prismaUnscoped.user.update({ where: { email: String(req.body.email) }, data: { platformRole: "SUPER_ADMIN" } });
    res.json({ ok: true });
  });
  outer.post("/__e2e/trends-run", express.json(), async (req, res) => {
    const { trendsService } = await import("../src/modules/trends/trends.service");
    res.json(await trendsService.runWeek(new Date(), req.body as { tenantIds?: string[]; markets?: string[]; categories?: string[] }));
  });
  outer.use(app);

  // Loopback only, on IPv4 and (where the machine has it) IPv6, since "localhost" may resolve to either.
  outer.listen(port, "127.0.0.1", () => console.log(`E2E API listening on http://localhost:${port} (loopback only)`));
  createServer(outer).on("error", () => undefined).listen(port, "::1");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
