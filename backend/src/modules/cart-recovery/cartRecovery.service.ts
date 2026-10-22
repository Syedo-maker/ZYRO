import { getRedis } from "../../lib/redis";
import { prismaUnscoped } from "../../lib/prisma";
import { tenantContext } from "../../lib/tenantContext";
import { env } from "../../config/env";
import { cartService, type CartOwner } from "../cart/cart.service";
import { generateRevocable } from "../ai/ai.orchestrator";
import { emailStatus, getEmailGateway } from "../../lib/email";
import { AppError } from "../../errors/AppError";
import { logger } from "../../lib/logger";
import { formatPrice } from "../../lib/currencies";

/**
 * Module 7 (remaining): Abandoned-Cart Recovery (Implementation_Plan.md Phase 5). A BullMQ
 * repeatable job (lib/cartRecoveryQueue.ts) calls `scan()` on an interval; everything else here
 * is plain functions, easy to call directly from a verify script without going through Redis's
 * own clock.
 *
 * Only signed-in shoppers' carts are ever recovered: a guest cart (`cart:{storeId}:g:{id}`) has
 * no email address anywhere in the system to send a recovery message to, since nothing about a
 * guest is known until they reach checkout - a deliberate scope boundary, not an oversight.
 */

/** Redis refreshes a cart's TTL to the same fixed value (env.cartTtlSeconds) on every touch
 *  (cart.service.ts), so the remaining TTL is a reliable proxy for time since the last touch:
 *  no separate "last activity" timestamp needs to be stored anywhere. */
function inactiveSecondsFromTtl(ttl: number): number {
  return env.cartTtlSeconds - ttl;
}

function parseUserCartKey(key: string): { storeId: string; userId: string } | null {
  // cart:{storeId}:u:{userId} - see cartKey() in cart.service.ts. storeId and userId are cuids
  // (no colons), so a plain split is safe here.
  const parts = key.split(":");
  if (parts.length !== 4 || parts[0] !== "cart" || parts[2] !== "u") return null;
  return { storeId: parts[1], userId: parts[3] };
}

async function* scanUserCartKeys(): AsyncGenerator<string> {
  const stream = getRedis().scanStream({ match: "cart:*:u:*", count: 100 });
  for await (const keys of stream) {
    for (const key of keys as string[]) yield key;
  }
}

const RECOVERY_SYSTEM_PROMPT =
  "You write short, warm cart-recovery emails for an online store, reminding a shopper about items still in " +
  "their cart. 2 to 4 sentences, plain prose, no subject line, no markdown, friendly and never pushy. Mention " +
  "the items by name. If a discount code is given, mention it naturally, once; if none is given, do not invent one.";

async function findActiveDiscount(tenantId: string) {
  const now = new Date();
  return prismaUnscoped.discountCode.findFirst({
    where: { tenantId, active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { createdAt: "desc" },
  });
}

/** One candidate cart: abandoned long enough, not already recovered recently, not already
 *  converted. Returns quietly (no email, no error) for anything that turns out not to qualify -
 *  a scan finding nothing to do on a given pass is the normal case, not a failure.
 *
 * Runs inside tenantContext.run(): a BullMQ job has no ambient tenant context the way an HTTP
 * request does (withTenantContext middleware), but cartService.get() and the AI orchestrator's
 * own quota bookkeeping both touch tenant-scoped Prisma models that require one. */
/** "no-email": the cart was due a reminder, but email is not configured, so nothing was written or spent. */
type Outcome = "sent" | "skipped" | "no-email";

async function recoverOne(storeId: string, userId: string, key: string): Promise<Outcome> {
  return tenantContext.run(storeId, () => recoverOneInContext(storeId, userId, key));
}

async function recoverOneInContext(storeId: string, userId: string, key: string): Promise<Outcome> {
  const ttl = await getRedis().ttl(key);
  if (ttl < 0) return "skipped"; // no TTL set, or the key vanished between SCAN and here
  if (inactiveSecondsFromTtl(ttl) < env.cartRecovery.abandonedAfterHours * 60 * 60) return "skipped";

  // Before the cart is read: a cart outlives a deleted store in Redis (up to its 7-day TTL), and
  // reading it would fail with "Store not found" on every scan until then.
  const tenant = await prismaUnscoped.tenant.findUnique({ where: { id: storeId }, select: { name: true, currency: true } });
  if (!tenant) return "skipped";

  const owner: CartOwner = { kind: "user", id: userId };
  const cart = await cartService.get(storeId, owner);
  if (cart.items.length === 0) return "skipped";

  const cooldownCutoff = new Date(Date.now() - env.cartRecovery.cooldownHours * 60 * 60 * 1000);
  const recent = await prismaUnscoped.cartRecoveryEvent.findFirst({ where: { tenantId: storeId, cartId: key, sentAt: { gte: cooldownCutoff } } });
  if (recent) return "skipped"; // already emailed about this cart recently; do not repeat every scan

  const user = await prismaUnscoped.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
  if (!user) return "skipped"; // account deleted since the cart was created

  // Defensive: the checkout webhook clears the Redis cart on a completed order (stripe.webhook.ts),
  // so this should already be moot, but that clear is fire-and-forget - never skip this check.
  const alreadyConverted = await prismaUnscoped.order.findFirst({
    where: { tenantId: storeId, status: { in: ["PAID", "FULFILLED", "COMPLETED"] }, customer: { is: { email: user.email } } },
    select: { id: true },
  });
  if (alreadyConverted) return "skipped";

  // Before the AI writes anything: a message that cannot be sent would still use the store's AI
  // allowance, and with no event recorded the next scan would write (and charge for) it again.
  let email: ReturnType<typeof getEmailGateway>;
  try {
    email = getEmailGateway();
  } catch {
    return "no-email";
  }

  const discount = await findActiveDiscount(storeId);
  const itemLines = cart.items.map((i) => `${i.quantity}x ${i.title}`).join(", ");
  const discountLine = discount
    ? `Available discount code: ${discount.code} (${discount.type === "PERCENTAGE" ? `${Number(discount.value)}% off` : `${formatPrice(Number(discount.value), tenant.currency)} off`})`
    : "No discount code to mention.";

  let generated: Awaited<ReturnType<typeof generateRevocable>>;
  try {
    generated = await generateRevocable({
      tenantId: storeId,
      promptType: "cart_recovery",
      system: RECOVERY_SYSTEM_PROMPT,
      prompt: `Store: ${tenant.name}\nShopper's cart: ${itemLines}\n${discountLine}`,
      maxTokens: 250,
    });
  } catch (err) {
    // Quota exhausted (402) or the provider unavailable (503): skip this cart this scan rather
    // than send a generic, unpersonalized email that was never part of the design.
    if (err instanceof AppError) return "skipped";
    throw err;
  }

  try {
    await email.send({ to: user.email, subject: `You left something in your cart at ${tenant.name}`, text: generated.result.text });
  } catch (err) {
    // The provider refused it, or did not answer: nothing reached the shopper, so the store gets its
    // AI turn back (it is charged only for a message that was sent) and nothing is recorded, so a
    // later scan tries again. The provider's message is logged; the email settings never are.
    await generated.release();
    logger.warn({ storeId, err: err instanceof Error ? err.message : String(err) }, "a cart recovery email could not be sent");
    return "skipped";
  }

  await prismaUnscoped.cartRecoveryEvent.create({
    data: { tenantId: storeId, cartId: key, customerEmail: user.email, discountCodeId: discount?.id },
  });
  return "sent";
}

/** A SENT event whose customer has since completed an order in the same store becomes
 *  CONVERTED. Run every scan, independent of the cart-key loop above: a completed order clears
 *  its Redis cart (stripe.webhook.ts), so the key that earned the SENT event is usually already
 *  gone by the time this can be observed. */
async function markConversions(): Promise<number> {
  const pending = await prismaUnscoped.cartRecoveryEvent.findMany({ where: { status: "SENT" }, take: 500 });
  let converted = 0;
  for (const event of pending) {
    const order = await prismaUnscoped.order.findFirst({
      where: { tenantId: event.tenantId, status: { in: ["PAID", "FULFILLED", "COMPLETED"] }, createdAt: { gt: event.sentAt }, customer: { is: { email: event.customerEmail } } },
      select: { id: true },
    });
    if (order) {
      await prismaUnscoped.cartRecoveryEvent.updateMany({ where: { id: event.id, status: "SENT" }, data: { status: "CONVERTED" } });
      converted++;
    }
  }
  return converted;
}

export const cartRecoveryService = {
  /** The repeatable job's body. Never throws for an individual cart's problem; only a genuine
   *  infrastructure failure (Redis or Postgres unreachable) propagates. */
  async scan(): Promise<{ scanned: number; sent: number; converted: number }> {
    let scanned = 0;
    let sent = 0;
    let waitingForEmail = 0;
    for await (const key of scanUserCartKeys()) {
      const parsed = parseUserCartKey(key);
      if (!parsed) continue;
      scanned++;
      try {
        const outcome = await recoverOne(parsed.storeId, parsed.userId, key);
        if (outcome === "sent") sent++;
        if (outcome === "no-email") waitingForEmail++;
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : String(err), storeId: parsed.storeId }, "cart recovery failed for one cart");
      }
    }
    if (waitingForEmail > 0) {
      // The setting names come from the email provider (lib/email.ts); never their values.
      logger.warn({ carts: waitingForEmail, missing: emailStatus().missing }, "abandoned carts are due a reminder, but email sending is not set up; no AI message was written");
    }
    const converted = await markConversions();
    return { scanned, sent, converted };
  },

  /** Merchant-facing performance summary: Implementation_Plan.md Phase 5's exit criteria names
   *  this as feeding the Marketing & Analytics dashboard. */
  async performance(tenantId: string) {
    const rows = await prismaUnscoped.cartRecoveryEvent.groupBy({ by: ["status"], where: { tenantId }, _count: { _all: true } });
    const counts = { SENT: 0, OPENED: 0, CLICKED: 0, CONVERTED: 0 } as Record<string, number>;
    for (const r of rows) counts[r.status] = r._count._all;
    const totalSent = counts.SENT + counts.OPENED + counts.CLICKED + counts.CONVERTED;
    return {
      /** False while the platform's email sending is not set up: no reminder can go out until it is. */
      emailConfigured: emailStatus().configured,
      sent: totalSent,
      opened: counts.OPENED,
      clicked: counts.CLICKED,
      converted: counts.CONVERTED,
      conversionRate: totalSent > 0 ? Math.round((counts.CONVERTED / totalSent) * 1000) / 10 : 0,
    };
  },
};
