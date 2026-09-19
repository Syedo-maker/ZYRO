import { Types } from "mongoose";
import { prisma, prismaUnscoped } from "../../lib/prisma";
import { getRedis } from "../../lib/redis";
import { getStripeGateway } from "../../lib/stripe";
import { env } from "../../config/env";
import { Product } from "../../models/Product.model";
import { Errors } from "../../errors/AppError";
import { inventoryService } from "../inventory/inventory.service";
import { calculateTotals } from "../commerce/pricing.service";
import type { OrderSnapshot, PricedLine } from "../commerce/order.service";
import { cartKey, CartOwner } from "../cart/cart.service";
import type { CreateSessionInput } from "./checkout.validation";

/** Stripe requires a Checkout Session to stay open for at least 30 minutes. */
const SESSION_MINUTES = 31;

export const checkoutService = {
  /**
   * Prices the shopper's cart, freezes it as a CheckoutSession snapshot, and creates the
   * Stripe-hosted checkout page. No order exists yet: the webhook creates it once Stripe
   * confirms payment (webhook.service.ts).
   */
  async createSession(storeId: string, owner: CartOwner, input: CreateSessionInput) {
    if (input.discountCode) {
      throw Errors.validation("Discount codes are not available yet");
    }

    // Fail early with a clear 503 if Stripe is not configured, before touching any data.
    const stripe = getStripeGateway();

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

    const totals = calculateTotals({
      lines,
      shippingAmount: shipping?.amount,
      taxRatePercent: Number(tenant.taxRate.toString()),
    });
    const snapshot: OrderSnapshot = { lines, totals };

    const expiresAt = new Date(Date.now() + SESSION_MINUTES * 60 * 1000);
    const record = await prisma.checkoutSession.create({
      data: {
        tenantId: storeId,
        userId: owner.kind === "user" ? owner.id : undefined,
        cartKey: key,
        snapshot: snapshot as unknown as object,
        totalCents: totals.totalCents,
        currency: tenant.currency,
        expiresAt,
      },
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
        successUrl: `${env.corsOrigin}/checkout/success?store=${storeId}&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${env.corsOrigin}/cart?store=${storeId}`,
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
};
