import type Stripe from "stripe";
import { Prisma, type PlanTier } from "@prisma/client";
import { prisma, prismaUnscoped } from "../../lib/prisma";
import { tenantContext } from "../../lib/tenantContext";
import { getStripeGateway, type BillingSubscription } from "../../lib/stripe";
import { BILLING_CURRENCY, PLANS, findTopUpPack } from "../../lib/plans";

/**
 * The only code that changes a store's plan or credits (Part A). It runs from the Stripe webhook
 * after the signature has been verified (webhooks/webhook.controller.ts), so a plan changes only
 * because Stripe says money was actually taken, never because a browser, a request or an AI
 * reply said so.
 *
 * Two rules keep it safe to run any number of times and in any order, since Stripe retries and
 * does not promise ordering:
 * - A top-up is credited exactly once: the purchase row's unique Stripe session id turns a second
 *   delivery into a no-op inside the same transaction as the credit.
 * - A subscription event never carries the state; it only says "look again". The current
 *   subscription is fetched from Stripe and applied, so a late "updated" cannot undo a later
 *   "cancelled". Events about an older subscription than the one the store now has are ignored.
 */

export type BillingOutcome =
  | "plan-updated"
  | "plan-ended"
  | "topup-credited"
  | "already-processed"
  | "ignored"
  | "rejected";

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

const idOf = (value: string | { id: string } | null | undefined) => (typeof value === "string" ? value : value?.id);

const PAID_TIERS: PlanTier[] = ["PRO", "BUSINESS"];
const isPaidTier = (value: string | null): value is "PRO" | "BUSINESS" => !!value && (PAID_TIERS as string[]).includes(value);

/** Checkout Sessions whose metadata says they are ZYRO billing rather than a shopper's order. */
export const billingPurpose = (session: Stripe.Checkout.Session): "subscription" | "ai_topup" | null => {
  const purpose = session.metadata?.purpose;
  return purpose === "subscription" || purpose === "ai_topup" ? purpose : null;
};

/** The paid checkout of a subscription: remember the Stripe ids, then take the plan from the subscription itself. */
export async function handleSubscriptionCheckout(session: Stripe.Checkout.Session): Promise<BillingOutcome> {
  const tenantId = session.metadata?.tenantId;
  const tier = session.metadata?.plan;
  const subscriptionId = idOf(session.subscription);
  const customerId = idOf(session.customer);
  if (!tenantId || !isPaidTier(tier ?? null) || !subscriptionId || !customerId) return "ignored";
  if (session.mode !== "subscription") return "ignored";
  // An unpaid session is a delayed payment method still pending: the subscription events will follow when it settles.
  if (session.payment_status === "unpaid") return "ignored";

  // What was charged must be what this plan costs; otherwise refuse to upgrade and say so loudly.
  const expected = PLANS[tier as "PRO" | "BUSINESS"];
  if (session.amount_total !== expected.priceCents || session.currency?.toLowerCase() !== BILLING_CURRENCY) {
    console.error(`Stripe session ${session.id}: plan ${tier} charged ${session.amount_total} ${session.currency}, expected ${expected.priceCents} ${BILLING_CURRENCY}`);
    return "rejected";
  }

  const tenant = await prismaUnscoped.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return "ignored";
  try {
    await prismaUnscoped.tenant.update({ where: { id: tenantId }, data: { stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId } });
  } catch (err) {
    if (isUniqueViolation(err)) return "rejected"; // that Stripe customer or subscription already belongs to another store
    throw err;
  }
  return syncSubscription(subscriptionId);
}

/** Reads the subscription as Stripe has it now and applies it to the store it belongs to. */
export async function syncSubscription(subscriptionId: string): Promise<BillingOutcome> {
  const sub = await getStripeGateway().retrieveSubscription(subscriptionId);
  const tenant =
    (await prismaUnscoped.tenant.findFirst({ where: { stripeSubscriptionId: sub.id } })) ??
    (sub.tenantId ? await prismaUnscoped.tenant.findUnique({ where: { id: sub.tenantId } }) : null);
  if (!tenant) return "ignored";
  // The store has moved on to a different subscription (it cancelled and resubscribed): this is an old one.
  if (tenant.stripeSubscriptionId && tenant.stripeSubscriptionId !== sub.id) return "ignored";
  return applySubscription(tenant.id, sub);
}

async function applySubscription(tenantId: string, sub: BillingSubscription): Promise<BillingOutcome> {
  switch (sub.status) {
    case "active":
    case "trialing": {
      if (!isPaidTier(sub.plan) || !sub.currentPeriodEnd) return "ignored";
      await prismaUnscoped.tenant.update({
        where: { id: tenantId },
        data: { plan: sub.plan, planExpiresAt: sub.currentPeriodEnd, stripeSubscriptionId: sub.id, stripeCustomerId: sub.customerId },
      });
      return "plan-updated";
    }
    case "canceled":
    case "unpaid":
    case "incomplete_expired": {
      // The renewal was never paid, or the subscription was cancelled and its period has ended: back to Free.
      await prismaUnscoped.tenant.update({
        where: { id: tenantId },
        data: { plan: "FREE", planExpiresAt: null, stripeSubscriptionId: null },
      });
      return "plan-ended";
    }
    default:
      // past_due: Stripe is still retrying the payment. The paid period (plus the grace in
      // lib/plans.ts effectiveTier) keeps running out on its own; if the retries fail, "unpaid"
      // or "canceled" arrives and ends the plan. incomplete / paused: nothing to change yet.
      return "ignored";
  }
}

/** A paid top-up pack: credit it once. */
export async function handleTopUpCheckout(session: Stripe.Checkout.Session): Promise<BillingOutcome> {
  const tenantId = session.metadata?.tenantId;
  const pack = findTopUpPack(session.metadata?.packId ?? "");
  if (!tenantId || !pack || session.mode !== "payment") return "ignored";
  if (session.payment_status !== "paid") return "ignored"; // a delayed method: async_payment_succeeded comes later

  // Credit what the catalog says this pack contains, and only if the charged amount matches its price.
  if (session.amount_total !== pack.priceCents || session.currency?.toLowerCase() !== BILLING_CURRENCY) {
    console.error(`Stripe session ${session.id}: top-up ${pack.id} charged ${session.amount_total} ${session.currency}, expected ${pack.priceCents} ${BILLING_CURRENCY}`);
    return "rejected";
  }
  const tenant = await prismaUnscoped.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) return "ignored";

  try {
    // The whole transaction is awaited inside the callback: it must run while the tenant context is active.
    await tenantContext.run(tenantId, async () => {
      await prisma.$transaction(async (tx) => {
        await tx.aiTopUpPurchase.create({
          data: {
            tenantId,
            packId: pack.id,
            generations: pack.generations,
            chatMessages: pack.chatMessages,
            amountCents: pack.priceCents,
            currency: BILLING_CURRENCY,
            stripeSessionId: session.id,
          },
        });
        await tx.tenant.update({
          where: { id: tenantId },
          data: { aiTopUpGenerations: { increment: pack.generations }, aiTopUpChatMessages: { increment: pack.chatMessages } },
        });
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) return "already-processed";
    throw err;
  }
  return "topup-credited";
}
