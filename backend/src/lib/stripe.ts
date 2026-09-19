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
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
}

/** What the rest of the app needs from Stripe. Kept small so tests can substitute a fake. */
export interface StripeGateway {
  createCheckoutSession(params: CheckoutSessionParams): Promise<{ id: string; url: string }>;
  refundPaymentIntent(paymentIntentId: string, idempotencyKey: string): Promise<void>;
  /** Verifies the Stripe-Signature header against the raw body. Throws if invalid. */
  constructEvent(rawBody: Buffer, signature: string): Stripe.Event;
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

  return {
    async createCheckoutSession(p) {
      const currency = p.currency.toLowerCase();
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        // No payment_method_types: Stripe picks eligible methods from Dashboard settings.
        client_reference_id: p.checkoutSessionId,
        metadata: { checkoutSessionId: p.checkoutSessionId, tenantId: p.tenantId },
        integration_identifier: `zyro-online-checkout-${randomSuffix()}`,
        customer_email: p.customerEmail,
        line_items: p.lineItems.map((item) => ({
          quantity: item.quantity,
          price_data: {
            currency,
            unit_amount: item.unitAmountCents,
            product_data: { name: item.name },
          },
        })),
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
      await stripe.refunds.create({ payment_intent: paymentIntentId }, { idempotencyKey });
    },

    constructEvent(rawBody, signature) {
      return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
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
