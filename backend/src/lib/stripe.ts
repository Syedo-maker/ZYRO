import { createHash } from "node:crypto";
import Stripe from "stripe";
import { env } from "../config/env";
import { Errors } from "../errors/AppError";

export interface CheckoutSessionParams {
  checkoutSessionId: string;
  tenantId: string;
  currency: string;
  customerEmail?: string;
  lineItems: { name: string; unitAmountCents: number; quantity: number }[];
  shipping?: { name: string; amountCents: number };
  /**
   * A discount taken off the order, as a fixed amount. The line items above carry the full
   * prices and the tax already worked out on the discounted subtotal, so the amount off is
   * exactly the discount and Stripe's total equals the total ZYRO priced.
   */
  discount?: { name: string; amountOffCents: number };
  /** ISO country codes Stripe may collect a shipping address for. */
  shippingCountries: string[];
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
}

/** A ZYRO plan subscription, reduced to what billing needs (never a raw Stripe object). */
export interface BillingSubscription {
  id: string;
  customerId: string;
  /** Stripe's own status: active, trialing, past_due, canceled, unpaid, incomplete, ... */
  status: string;
  /** The plan tier ZYRO put in the subscription's metadata at checkout; null if missing. */
  plan: string | null;
  /** The store ZYRO put in the metadata at checkout; null if missing. */
  tenantId: string | null;
  /** End of the period paid for; null if Stripe reports none. */
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

interface BillingCheckoutBase {
  tenantId: string;
  /** Reuse the store's Stripe customer if it has one, otherwise let Checkout make one from the email. */
  customerId?: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
}

export interface SubscriptionCheckoutParams extends BillingCheckoutBase {
  plan: string;
  planName: string;
  priceCents: number;
  currency: string;
}

export interface TopUpCheckoutParams extends BillingCheckoutBase {
  packId: string;
  packName: string;
  priceCents: number;
  currency: string;
}

/** What the rest of the app needs from Stripe. Kept small so tests can substitute a fake. */
export interface StripeGateway {
  /** Starts a monthly plan subscription. The plan only changes later, from the verified webhook. */
  createSubscriptionCheckout(params: SubscriptionCheckoutParams): Promise<{ id: string; url: string }>;
  /** A one-off AI top-up pack purchase. Credits are added only from the verified webhook. */
  createTopUpCheckout(params: TopUpCheckoutParams): Promise<{ id: string; url: string }>;
  /** A link where the store manages its card, sees invoices and cancels its subscription. */
  createBillingPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
  /** The subscription as Stripe has it right now (webhooks can arrive out of order, so state is read, not inferred). */
  retrieveSubscription(subscriptionId: string): Promise<BillingSubscription>;
  createCheckoutSession(params: CheckoutSessionParams): Promise<{ id: string; url: string }>;
  /** Refunds the full payment. The same idempotency key always yields the same refund. */
  refundPaymentIntent(paymentIntentId: string, idempotencyKey: string): Promise<{ id: string }>;
  /** Verifies the Stripe-Signature header against the raw body. Throws if invalid. */
  constructEvent(rawBody: Buffer, signature: string): Stripe.Event;
  /**
   * Makes a Checkout Session unpayable. Throws if Stripe cannot confirm that (already paid,
   * already expired, or a network failure); the caller (checkout.service.ts, superseding a
   * cart's own earlier discount hold) treats that as "assume it might still be paid" rather
   * than silently discarding a payment Stripe may still accept.
   */
  expireCheckoutSession(stripeSessionId: string): Promise<void>;
}

const randomSuffix = () =>
  Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");

function createRealGateway(): StripeGateway {
  const { secretKey, webhookSecret } = env.stripe;
  if (!secretKey || !webhookSecret) {
    throw Errors.serviceUnavailable("Stripe is not configured (set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET)");
  }
  // One client instance per process; the API key is never set globally.
  const stripe = new Stripe(secretKey);

  /**
   * Stripe applies a discount through a Coupon object. A fixed-amount coupon is fully
   * described by its name, amount and currency, so it is created once under an id derived
   * from those and reused by every checkout with the same discount.
   */
  async function couponFor(name: string, amountOffCents: number, currency: string): Promise<string> {
    const id = `zyro-${createHash("sha256").update(`${name}|${amountOffCents}|${currency}`).digest("hex").slice(0, 24)}`;
    try {
      await stripe.coupons.retrieve(id);
    } catch (err) {
      if ((err as { code?: string }).code !== "resource_missing") throw err;
      try {
        await stripe.coupons.create({ id, name, amount_off: amountOffCents, currency, duration: "once" });
      } catch (createErr) {
        // Two checkouts created the same coupon at once; the second finds it already there.
        if ((createErr as { code?: string }).code !== "resource_already_exists") throw createErr;
      }
    }
    return id;
  }

  /**
   * The Billing Portal needs a saved configuration before it will open. This makes one that lets
   * the store update its card, see invoices and cancel at the end of the period, and reuses it
   * (found by its metadata) on later calls and restarts. Changing between paid plans is
   * deliberately not offered there: a plan change goes through ZYRO's own checkout, so the plan
   * ZYRO records always comes from a subscription ZYRO created.
   */
  let portalConfigId: string | undefined;
  async function portalConfiguration(): Promise<string> {
    if (portalConfigId) return portalConfigId;
    const existing = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
    const ours = existing.data.find((c) => c.metadata?.app === "zyro");
    if (ours) return (portalConfigId = ours.id);
    const created = await stripe.billingPortal.configurations.create({
      metadata: { app: "zyro" },
      business_profile: { headline: "Manage your ZYRO subscription" },
      features: {
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true, mode: "at_period_end" },
      },
    });
    return (portalConfigId = created.id);
  }

  return {
    async createCheckoutSession(p) {
      const currency = p.currency.toLowerCase();
      const coupon = p.discount ? await couponFor(p.discount.name, p.discount.amountOffCents, currency) : undefined;
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        // No payment_method_types: Stripe picks eligible methods from Dashboard settings.
        client_reference_id: p.checkoutSessionId,
        metadata: { checkoutSessionId: p.checkoutSessionId, tenantId: p.tenantId },
        integration_identifier: `zyro-online-checkout-${randomSuffix()}`,
        customer_email: p.customerEmail,
        // Always charge in the store's currency. With Adaptive Pricing on, Stripe's page
        // offers the shopper a converted local currency, but ZYRO prices, taxes and records
        // orders in the store currency and refuses an order whose charged amount differs.
        adaptive_pricing: { enabled: false },
        // Stripe's page collects the address; the webhook copies it onto the order.
        shipping_address_collection: {
          allowed_countries: p.shippingCountries as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[],
        },
        line_items: p.lineItems.map((item) => ({
          quantity: item.quantity,
          price_data: {
            currency,
            unit_amount: item.unitAmountCents,
            product_data: { name: item.name },
          },
        })),
        ...(coupon ? { discounts: [{ coupon }] } : {}),
        ...(p.shipping
          ? {
              shipping_options: [
                {
                  shipping_rate_data: {
                    type: "fixed_amount" as const,
                    display_name: p.shipping.name,
                    fixed_amount: { amount: p.shipping.amountCents, currency },
                  },
                },
              ],
            }
          : {}),
        success_url: p.successUrl,
        cancel_url: p.cancelUrl,
        expires_at: Math.floor(p.expiresAt.getTime() / 1000),
      });
      if (!session.url) throw new Error("Stripe returned a Checkout Session without a URL");
      return { id: session.id, url: session.url };
    },

    async refundPaymentIntent(paymentIntentId, idempotencyKey) {
      const refund = await stripe.refunds.create({ payment_intent: paymentIntentId }, { idempotencyKey });
      return { id: refund.id };
    },

    constructEvent(rawBody, signature) {
      return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    },

    async expireCheckoutSession(stripeSessionId) {
      await stripe.checkout.sessions.expire(stripeSessionId);
    },

    async createSubscriptionCheckout(p) {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        client_reference_id: p.tenantId,
        // `purpose` is how the webhook tells a plan purchase from a shopper's order payment.
        metadata: { purpose: "subscription", tenantId: p.tenantId, plan: p.plan },
        subscription_data: { metadata: { tenantId: p.tenantId, plan: p.plan } },
        integration_identifier: `zyro-billing-subscription-${randomSuffix()}`,
        ...(p.customerId ? { customer: p.customerId } : { customer_email: p.customerEmail }),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: p.currency,
              unit_amount: p.priceCents,
              recurring: { interval: "month" },
              product_data: { name: `ZYRO ${p.planName} plan`, metadata: { plan: p.plan } },
            },
          },
        ],
        success_url: p.successUrl,
        cancel_url: p.cancelUrl,
      });
      if (!session.url) throw new Error("Stripe returned a Checkout Session without a URL");
      return { id: session.id, url: session.url };
    },

    async createTopUpCheckout(p) {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        client_reference_id: p.tenantId,
        metadata: { purpose: "ai_topup", tenantId: p.tenantId, packId: p.packId },
        integration_identifier: `zyro-billing-topup-${randomSuffix()}`,
        adaptive_pricing: { enabled: false },
        ...(p.customerId ? { customer: p.customerId } : { customer_email: p.customerEmail }),
        line_items: [
          { quantity: 1, price_data: { currency: p.currency, unit_amount: p.priceCents, product_data: { name: `ZYRO ${p.packName}` } } },
        ],
        success_url: p.successUrl,
        cancel_url: p.cancelUrl,
      });
      if (!session.url) throw new Error("Stripe returned a Checkout Session without a URL");
      return { id: session.id, url: session.url };
    },

    async createBillingPortalSession(customerId, returnUrl) {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
        configuration: await portalConfiguration(),
      });
      return { url: session.url };
    },

    async retrieveSubscription(subscriptionId) {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      // Since API version 2025-03-31 the paid period is on the items, not on the subscription.
      const ends = sub.items.data.map((item) => item.current_period_end);
      return {
        id: sub.id,
        customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
        status: sub.status,
        plan: sub.metadata?.plan ?? null,
        tenantId: sub.metadata?.tenantId ?? null,
        currentPeriodEnd: ends.length > 0 ? new Date(Math.max(...ends) * 1000) : null,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      };
    },
  };
}

let override: StripeGateway | undefined;
let real: StripeGateway | undefined;

/** Tests and scripts inject a fake here; pass undefined to restore the real gateway. */
export function setStripeGateway(gateway: StripeGateway | undefined) {
  override = gateway;
}

export function getStripeGateway(): StripeGateway {
  if (override) return override;
  real ??= createRealGateway();
  return real;
}
