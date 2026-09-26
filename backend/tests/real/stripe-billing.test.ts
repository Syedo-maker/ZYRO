/**
 * Runs Part A's billing against a real Stripe **test-mode** sandbox (no real money): the key's
 * permissions, the Checkout Sessions the gateway creates, the Billing Portal, reading a real
 * subscription back, and webhook signature checking with the configured secret. Never runs with
 * `npm test`; run it on purpose:
 *   npm run test:real -- stripe-billing
 * Needs STRIPE_SECRET_KEY (a test key, sk_test or rk_test) and STRIPE_WEBHOOK_SECRET in backend/.env.
 * Everything it creates in Stripe (a customer, a product, a subscription) is removed afterwards.
 */
import "dotenv/config";
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY ?? "";
const isTestKey = /^(sk|rk)_test_/.test(key) || /^rkcs_test_/.test(key);

describe("real Stripe test mode", () => {
  if (!key || !process.env.STRIPE_WEBHOOK_SECRET) {
    it("needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in backend/.env", () => {
      throw new Error("Stripe keys are not set, so billing was not run against Stripe. Add test-mode keys to backend/.env and run again.");
    });
    return;
  }
  if (!isTestKey) {
    it("refuses to run against a live key", () => {
      throw new Error("STRIPE_SECRET_KEY is not a test-mode key. This suite only ever runs against test mode.");
    });
    return;
  }

  const stripe = new Stripe(key);
  let gateway: import("../../src/lib/stripe").StripeGateway;
  let plans: typeof import("../../src/lib/plans");
  const made: { customer?: string; product?: string; subscription?: string } = {};

  beforeAll(async () => {
    gateway = (await import("../../src/lib/stripe")).getStripeGateway();
    plans = await import("../../src/lib/plans");
  });

  afterAll(async () => {
    if (made.subscription) await stripe.subscriptions.cancel(made.subscription).catch(() => undefined);
    if (made.customer) await stripe.customers.del(made.customer).catch(() => undefined);
    if (made.product) await stripe.products.update(made.product, { active: false }).catch(() => undefined);
  });

  it("a subscription checkout is created at the catalog's price, monthly, with the plan in its metadata", async () => {
    const { id, url } = await gateway.createSubscriptionCheckout({
      tenantId: "test-tenant",
      plan: "PRO",
      planName: plans.PLANS.PRO.name,
      priceCents: plans.PLANS.PRO.priceCents,
      currency: plans.BILLING_CURRENCY,
      customerEmail: "zyro-billing-test@example.com",
      successUrl: "http://localhost:5173/admin/billing?checkout=success",
      cancelUrl: "http://localhost:5173/admin/billing?checkout=cancelled",
    });
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const session = await stripe.checkout.sessions.retrieve(id, { expand: ["line_items"] });
    expect(session.mode).toBe("subscription");
    expect(session.amount_total).toBe(plans.PLANS.PRO.priceCents);
    expect(session.metadata).toMatchObject({ purpose: "subscription", tenantId: "test-tenant", plan: "PRO" });
    await stripe.checkout.sessions.expire(id).catch(() => undefined);
  });

  it("a top-up checkout is a one-off payment at the pack's price", async () => {
    const pack = plans.TOP_UP_PACKS[0];
    const { id } = await gateway.createTopUpCheckout({
      tenantId: "test-tenant",
      packId: pack.id,
      packName: pack.name,
      priceCents: pack.priceCents,
      currency: plans.BILLING_CURRENCY,
      customerEmail: "zyro-billing-test@example.com",
      successUrl: "http://localhost:5173/admin/billing?topup=success",
      cancelUrl: "http://localhost:5173/admin/billing?topup=cancelled",
    });
    const session = await stripe.checkout.sessions.retrieve(id);
    expect(session.mode).toBe("payment");
    expect(session.amount_total).toBe(pack.priceCents);
    expect(session.metadata).toMatchObject({ purpose: "ai_topup", packId: pack.id });
    await stripe.checkout.sessions.expire(id).catch(() => undefined);
  });

  it("a real subscription is read back with its plan, store, status and paid-until date", async () => {
    const customer = await stripe.customers.create({
      email: "zyro-billing-test@example.com",
      payment_method: "pm_card_visa",
      invoice_settings: { default_payment_method: "pm_card_visa" },
    });
    made.customer = customer.id;
    const product = await stripe.products.create({ name: "ZYRO billing test" });
    made.product = product.id;
    const sub = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price_data: { currency: plans.BILLING_CURRENCY, unit_amount: plans.PLANS.PRO.priceCents, recurring: { interval: "month" }, product: product.id } }],
      metadata: { tenantId: "test-tenant", plan: "PRO" },
    });
    made.subscription = sub.id;

    const read = await gateway.retrieveSubscription(sub.id);
    expect(read.status).toBe("active");
    expect(read.plan).toBe("PRO");
    expect(read.tenantId).toBe("test-tenant");
    expect(read.customerId).toBe(customer.id);
    expect(read.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now() + 25 * 24 * 60 * 60 * 1000);
  });

  it("the Billing Portal opens for that customer", async () => {
    const { url } = await gateway.createBillingPortalSession(made.customer!, "http://localhost:5173/admin/billing?portal=return");
    expect(url).toMatch(/^https:\/\/billing\.stripe\.com\//);
  });

  it("a webhook signed with the configured secret is accepted, and a forged one is refused", () => {
    const payload = JSON.stringify({ id: "evt_test", object: "event", type: "customer.subscription.updated", data: { object: { id: "sub_x" } } });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
    expect(gateway.constructEvent(Buffer.from(payload), header).type).toBe("customer.subscription.updated");
    const forged = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_not_the_real_one" });
    expect(() => gateway.constructEvent(Buffer.from(payload), forged)).toThrow();
  });
});
