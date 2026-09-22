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

/** What the rest of the app needs from Stripe. Kept small so tests can substitute a fake. */
export interface StripeGateway {
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
