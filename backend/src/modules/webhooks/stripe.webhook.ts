import type Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { prisma, prismaUnscoped } from "../../lib/prisma";
import { tenantContext } from "../../lib/tenantContext";
import { getStripeGateway } from "../../lib/stripe";
import { AppError } from "../../errors/AppError";
import { createOrder, OrderSnapshot } from "../commerce/order.service";
import { customerService } from "../customers/customer.service";
import { cartService } from "../cart/cart.service";

export type WebhookOutcome =
  | "fulfilled"
  | "already-processed"
  | "ignored"
  | "refunded-out-of-stock"
  | "marked-failed"
  | "marked-expired";

const isInsufficientStock = (err: unknown) =>
  err instanceof AppError && err.type.endsWith("/insufficient-stock");

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/**
 * Turns a paid Checkout Session into an order. Safe to run any number of times for the
 * same session (Stripe retries and can deliver an event twice): only a PENDING
 * CheckoutSession can be claimed, the claim and the order are one transaction, and
 * Order.stripeCheckoutSessionId is unique as a second guard.
 */
async function fulfil(session: Stripe.Checkout.Session): Promise<WebhookOutcome> {
  // Delayed payment methods send `completed` while still unpaid; the order is only
  // created on the later `async_payment_succeeded` event.
  if (session.payment_status === "unpaid") return "ignored";

  // Not tenant-scoped by path: the record found by Stripe's session id tells us the tenant.
  const record = await prismaUnscoped.checkoutSession.findUnique({ where: { stripeSessionId: session.id } });
  if (!record) return "ignored";
  if (record.status !== "PENDING") return "already-processed";

  const tenantId = record.tenantId;
  const snapshot = record.snapshot as unknown as OrderSnapshot;
  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;

  return tenantContext.run(tenantId, async () => {
    // What Stripe actually charged must match what we priced; never write an order that doesn't.
    if (session.amount_total !== record.totalCents || session.currency?.toLowerCase() !== record.currency.toLowerCase()) {
      console.error(`Stripe session ${session.id}: charged ${session.amount_total} ${session.currency}, expected ${record.totalCents} ${record.currency}`);
      await prisma.checkoutSession.updateMany({
        where: { id: record.id, tenantId, status: "PENDING" },
        data: { status: "FAILED", failureReason: "Charged amount did not match the priced cart" },
      });
      return "marked-failed";
    }

    const email = session.customer_details?.email ?? session.customer_email ?? undefined;
    const collected = session.collected_information?.shipping_details;
    const shipping = collected?.address
      ? {
          name: collected.name,
          address: {
            line1: collected.address.line1 ?? null,
            line2: collected.address.line2 ?? null,
            city: collected.address.city ?? null,
            state: collected.address.state ?? null,
            postalCode: collected.address.postal_code ?? null,
            country: collected.address.country ?? null,
          },
        }
      : undefined;

    try {
      const claimed = await prisma.$transaction(async (tx) => {
        const claim = await tx.checkoutSession.updateMany({
          where: { id: record.id, tenantId, status: "PENDING" },
          data: { status: "COMPLETED" },
        });
        if (claim.count === 0) return false;

        const customerId = await customerService.findOrCreate(tx, {
          tenantId,
          userId: record.userId ?? undefined,
          email,
          name: session.customer_details?.name ?? undefined,
        });

        const order = await createOrder(
          {
            tenantId,
            channel: "ONLINE",
            customerId,
            guestEmail: record.userId ? undefined : email,
            shipping,
            snapshot,
            // The use was held when the checkout began; the shopper has already paid the discounted price.
            discountCodeId: record.discountCodeId ?? undefined,
            redeem: "honour",
            payments: [{ method: "STRIPE", amount: record.totalCents / 100, stripePaymentIntentId: paymentIntentId }],
            stripeCheckoutSessionId: session.id,
          },
          tx
        );
        await tx.checkoutSession.updateMany({ where: { id: record.id, tenantId }, data: { orderId: order.id } });
        return true;
      });

      if (!claimed) return "already-processed";
      await cartService.clear(record.cartKey).catch((err) => console.error("Could not clear cart:", err));
      return "fulfilled";
    } catch (err) {
      if (isUniqueViolation(err)) return "already-processed";

      if (isInsufficientStock(err)) {
        // Another sale took the last unit between checkout and payment. The whole
        // transaction rolled back (no order, no stock change), so give the money back.
        if (!paymentIntentId) {
          await prisma.checkoutSession.updateMany({
            where: { id: record.id, tenantId, status: "PENDING" },
            data: { status: "FAILED", failureReason: "Out of stock and no payment to refund" },
          });
          return "marked-failed";
        }
        // If this call fails the error propagates (HTTP 500) so Stripe retries the webhook;
        // the idempotency key makes the retry safe.
        await getStripeGateway().refundPaymentIntent(paymentIntentId, `refund-${record.id}`);
        await prisma.checkoutSession.updateMany({
          where: { id: record.id, tenantId, status: "PENDING" },
          data: { status: "REFUNDED", failureReason: "Out of stock at payment time; refunded automatically" },
        });
        return "refunded-out-of-stock";
      }
      throw err;
    }
  });
}

async function close(session: Stripe.Checkout.Session, status: "EXPIRED" | "FAILED", reason: string): Promise<WebhookOutcome> {
  const record = await prismaUnscoped.checkoutSession.findUnique({ where: { stripeSessionId: session.id } });
  if (!record || record.status !== "PENDING") return "ignored";
  // The query must be awaited inside the callback: Prisma queries are lazy, and one that
  // is merely returned would run after the tenant context has already closed.
  await tenantContext.run(record.tenantId, async () => {
    await prisma.checkoutSession.updateMany({
      where: { id: record.id, tenantId: record.tenantId, status: "PENDING" },
      data: { status, failureReason: reason },
    });
  });
  return status === "EXPIRED" ? "marked-expired" : "marked-failed";
}

export async function handleStripeEvent(event: Stripe.Event): Promise<WebhookOutcome> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return fulfil(event.data.object as Stripe.Checkout.Session);
    case "checkout.session.async_payment_failed":
      return close(event.data.object as Stripe.Checkout.Session, "FAILED", "Payment failed");
    case "checkout.session.expired":
      return close(event.data.object as Stripe.Checkout.Session, "EXPIRED", "Checkout session expired");
    default:
      return "ignored";
  }
}
