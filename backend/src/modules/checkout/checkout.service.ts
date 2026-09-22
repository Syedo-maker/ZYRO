import { Types } from "mongoose";
import { prisma, prismaUnscoped } from "../../lib/prisma";
import { getRedis } from "../../lib/redis";
import { getStripeGateway } from "../../lib/stripe";
import { env } from "../../config/env";
import { Product } from "../../models/Product.model";
import { Errors } from "../../errors/AppError";
import { inventoryService } from "../inventory/inventory.service";
import { calculateTotals } from "../commerce/pricing.service";
import { discountService, type ResolvedDiscount } from "../discounts/discount.service";
import type { OrderSnapshot, PricedLine } from "../commerce/order.service";
import { cartKey, CartOwner } from "../cart/cart.service";
import type { CreateSessionInput, QuoteInput } from "./checkout.validation";

/** Stripe requires a Checkout Session to stay open for at least 30 minutes. */
const SESSION_MINUTES = 31;

/** Stripe cannot charge less than this (in the currency's smallest unit); a discount must not push an order below it. */
const MIN_CHARGE_CENTS = 50;

/**
 * Prices the shopper's cart from the live catalog and the store's settings. Used by both
 * the quote (a preview) and the checkout session (which freezes the same numbers), so the
 * total a shopper sees is by construction the total they are charged.
 */
async function priceCart(storeId: string, owner: CartOwner, input: QuoteInput) {
  const key = cartKey(storeId, owner);
  const raw = await getRedis().hgetall(key);
  const cartEntries = Object.entries(raw);
  if (cartEntries.length === 0) throw Errors.validation("Your cart is empty");

  const productIds = cartEntries.map(([id]) => id);
  if (!productIds.every((id) => Types.ObjectId.isValid(id))) throw Errors.validation("Your cart has an invalid item");
  const products = await Product.find({ storeId, _id: { $in: productIds } });
  const byId = new Map(products.map((p) => [p._id.toString(), p]));
  if (productIds.some((id) => !byId.has(id))) {
    throw Errors.validation("Some items in your cart are no longer available; please review your cart");
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: storeId } });
  if (!tenant) throw Errors.notFound("Store");

  const locationId = await inventoryService.getDefaultLocationId(prisma, storeId);
  const stock = await inventoryService.getTotals(prisma, storeId, productIds, locationId);
  const lines: PricedLine[] = cartEntries.map(([id, qty]) => {
    const product = byId.get(id)!;
    const quantity = Number(qty);
    if ((stock.get(id) ?? 0) < quantity) {
      throw Errors.insufficientStock(`Not enough stock for "${product.title}"`);
    }
    return {
      productId: id,
      title: product.title,
      unitPrice: Number(product.price.toString()),
      unitCost: product.costPrice ? Number(product.costPrice.toString()) : null,
      quantity,
      taxable: product.taxable !== false,
    };
  });

  let shipping: { name: string; amount: number } | undefined;
  if (input.shippingZoneId) {
    const zone = await prisma.shippingZone.findFirst({ where: { id: input.shippingZoneId, tenantId: storeId } });
    if (!zone) throw Errors.notFound("Shipping zone");
    shipping = { name: zone.name, amount: Number(zone.rateAmount.toString()) };
  }

  // One code per order, checked against the cart's subtotal (before discount, tax and shipping).
  const subtotalCents = lines.reduce((sum, l) => sum + Math.round(l.unitPrice * 100) * l.quantity, 0);
  const discount: ResolvedDiscount | null = input.discountCode
    ? await discountService.resolve(prisma, storeId, input.discountCode, subtotalCents, { excludeCartKey: key })
    : null;

  const totals = calculateTotals({
    lines,
    discount: discount ? { type: discount.type, value: discount.value } : null,
    shippingAmount: shipping?.amount,
    taxRatePercent: Number(tenant.taxRate.toString()),
  });
  const snapshot: OrderSnapshot = { lines, totals };
  return { key, tenant, shipping, snapshot, discount, subtotalCents };
}

export const checkoutService = {
  /** A price preview for the checkout page: same math as the real session, nothing saved. */
  async quote(storeId: string, owner: CartOwner, input: QuoteInput) {
    const { tenant, snapshot, discount } = await priceCart(storeId, owner, input);
    const t = snapshot.totals;
    return {
      currency: tenant.currency,
      discount: discount ? { code: discount.code, type: discount.type.toLowerCase(), value: discount.value } : null,
      subtotal: Number(t.subtotal),
      discountAmount: Number(t.discountAmount),
      taxAmount: Number(t.taxAmount),
      shippingAmount: Number(t.shippingAmount),
      total: Number(t.total),
    };
  },

  /**
   * Prices the shopper's cart, freezes it as a CheckoutSession snapshot, and creates the
   * Stripe-hosted checkout page. No order exists yet: the webhook creates it once Stripe
   * confirms payment (webhook.service.ts).
   */
  async createSession(storeId: string, owner: CartOwner, input: CreateSessionInput) {
    // Fail early with a clear 503 if Stripe is not configured, before touching any data.
    const stripe = getStripeGateway();

    const { key, tenant, shipping, snapshot, discount, subtotalCents } = await priceCart(storeId, owner, input);
    const { lines, totals } = snapshot;

    // A discount must never turn an order into one Stripe cannot charge (free, or under its minimum).
    if (discount && totals.totalCents < MIN_CHARGE_CENTS) {
      throw Errors.validation("After this discount the order total is too small to pay for online; remove the code or add more to your cart");
    }

    if (discount) {
      // Starting a new checkout for this cart supersedes any of its own still-pending holds on
      // a discount code, so retrying an abandoned attempt never lets the same cart hold a
      // limited code's last use twice over (a security review found the old code only ever
      // checked OTHER carts' holds, letting one shopper hoard a "1 use" code across unlimited
      // parallel, unpaid sessions - discount.service.ts's assertCanHold). The Stripe session is
      // expired FIRST and only marked FAILED here once Stripe confirms it can no longer be
      // paid, so a shopper genuinely mid-payment on an older tab is never silently short-changed
      // of an order they paid for: if expiring fails for any reason (already paid, already
      // expired, a network error), that old hold is left exactly as it was and still counts
      // below, same as any other real reservation.
      const stale = await prisma.checkoutSession.findMany({
        where: { tenantId: storeId, cartKey: key, status: "PENDING", expiresAt: { gt: new Date() }, discountCodeId: { not: null } },
        select: { id: true, stripeSessionId: true },
      });
      for (const s of stale) {
        if (!s.stripeSessionId) continue;
        try {
          await stripe.expireCheckoutSession(s.stripeSessionId);
        } catch {
          continue;
        }
        await prisma.checkoutSession.updateMany({
          where: { id: s.id, tenantId: storeId, status: "PENDING" },
          data: { status: "FAILED", failureReason: "Superseded by a new checkout for this cart" },
        });
      }
    }

    const expiresAt = new Date(Date.now() + SESSION_MINUTES * 60 * 1000);
    // With a code, the record is created in the same transaction that checks the code still has
    // a use to give, so the pending checkout holds that use from the moment it exists.
    const record = await prisma.$transaction(async (tx) => {
      if (discount) await discountService.assertCanHold(tx, storeId, discount.codeId, subtotalCents);
      return tx.checkoutSession.create({
        data: {
          tenantId: storeId,
          userId: owner.kind === "user" ? owner.id : undefined,
          cartKey: key,
          snapshot: snapshot as unknown as object,
          totalCents: totals.totalCents,
          currency: tenant.currency,
          discountCodeId: discount?.codeId,
          expiresAt,
        },
      });
    });

    const taxCents = Math.round(Number(totals.taxAmount) * 100);
    try {
      const customerEmail =
        owner.kind === "user"
          ? (await prismaUnscoped.user.findUnique({ where: { id: owner.id }, select: { email: true } }))?.email
          : undefined;

      const session = await stripe.createCheckoutSession({
        checkoutSessionId: record.id,
        tenantId: storeId,
        currency: tenant.currency,
        customerEmail,
        lineItems: [
          ...lines.map((l) => ({
            name: l.title,
            unitAmountCents: Math.round(l.unitPrice * 100),
            quantity: l.quantity,
          })),
          ...(taxCents > 0 ? [{ name: "Tax", unitAmountCents: taxCents, quantity: 1 }] : []),
        ],
        shipping: shipping ? { name: shipping.name, amountCents: Math.round(shipping.amount * 100) } : undefined,
        discount:
          discount && Number(totals.discountAmount) > 0
            ? { name: `Discount ${discount.code}`, amountOffCents: Math.round(Number(totals.discountAmount) * 100) }
            : undefined,
        shippingCountries: env.shippingCountries,
        successUrl: `${env.storefrontUrl}/store/${storeId}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${env.storefrontUrl}/store/${storeId}/cart`,
        expiresAt,
      });

      await prisma.checkoutSession.updateMany({
        where: { id: record.id, tenantId: storeId },
        data: { stripeSessionId: session.id },
      });
      return { checkoutUrl: session.url };
    } catch (err) {
      await prisma.checkoutSession.updateMany({
        where: { id: record.id, tenantId: storeId },
        data: { status: "FAILED", failureReason: "Could not create the Stripe session" },
      });
      throw err;
    }
  },

  /**
   * What the confirmation page shows after Stripe redirects back. The webhook, not the
   * redirect, creates the order, so it may not exist yet: the page polls until this
   * answers "completed". The unguessable Stripe session id in the URL is the only
   * credential, and only order-confirmation details are returned.
   */
  async getSessionStatus(storeId: string, stripeSessionId: string) {
    const record = await prisma.checkoutSession.findFirst({ where: { tenantId: storeId, stripeSessionId } });
    if (!record) throw Errors.notFound("Checkout session");

    const state = record.status.toLowerCase() as "pending" | "completed" | "expired" | "refunded" | "failed";
    if (record.status !== "COMPLETED" || !record.orderId) return { state, order: null };

    const order = await prisma.order.findFirst({
      where: { id: record.orderId, tenantId: storeId },
      include: { items: true, customer: true },
    });
    if (!order) return { state, order: null };

    return {
      state,
      order: {
        orderNumber: order.orderNumber,
        status: order.status.toLowerCase(),
        total: Number(order.total.toString()),
        currency: order.currency,
        email: order.guestEmail ?? order.customer?.email ?? null,
        shippingName: order.shippingName,
        items: order.items.map((i) => ({
          title: i.productTitleSnapshot,
          quantity: i.quantity,
          lineTotal: Number(i.lineTotal.toString()),
        })),
      },
    };
  },
};
