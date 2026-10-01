import { Types } from "mongoose";
import { prisma } from "../../lib/prisma";
import { getRedis } from "../../lib/redis";
import { Errors } from "../../errors/AppError";
import { Product } from "../../models/Product.model";
import { inventoryService } from "../inventory/inventory.service";
import { calculateTotals } from "../commerce/pricing.service";
import { discountService, type ResolvedDiscount } from "../discounts/discount.service";
import { createOrder, type OrderSnapshot, type PricedLine } from "../commerce/order.service";
import { cartKey, type CartOwner } from "../cart/cart.service";
import { paymentsService, type CodRiskSubject } from "./payments.service";
import type { PlaceLocalOrderInput } from "./payments.validation";

/**
 * Placing an order that is not paid by card (Part E): cash on delivery, or a bank or wallet transfer
 * the shopper makes themselves. Neither goes through Stripe, so this prices the cart the same way
 * checkout.service.ts does and writes the order directly, with a payment that is PENDING until the
 * money actually arrives.
 *
 * The order exists and the stock is held from the moment it is placed, exactly as for a card order:
 * a merchant packing a COD parcel needs the stock reserved. What differs is only that the money is
 * owed rather than received, which the PENDING payment and the PENDING order status both say.
 */

/** Prices the cart from the live catalog, the same checks a card checkout makes. */
async function priceCart(storeId: string, owner: CartOwner, discountCode?: string) {
  const key = cartKey(storeId, owner);
  const raw = await getRedis().hgetall(key);
  const entries = Object.entries(raw);
  if (entries.length === 0) throw Errors.validation("Your cart is empty");

  const productIds = entries.map(([id]) => id);
  if (!productIds.every((id) => Types.ObjectId.isValid(id))) throw Errors.validation("Your cart has an invalid item");
  const products = await Product.find({ storeId, _id: { $in: productIds } });
  const byId = new Map(products.map((p) => [p._id.toString(), p]));
  if (productIds.some((id) => !byId.has(id))) throw Errors.validation("Some items in your cart are no longer available; please review your cart");

  const tenant = await prisma.tenant.findUnique({ where: { id: storeId } });
  if (!tenant) throw Errors.notFound("Store");

  const locationId = await inventoryService.getDefaultLocationId(prisma, storeId);
  const stock = await inventoryService.getTotals(prisma, storeId, productIds, locationId);
  const lines: PricedLine[] = entries.map(([id, qty]) => {
    const product = byId.get(id)!;
    const quantity = Number(qty);
    if ((stock.get(id) ?? 0) < quantity) throw Errors.insufficientStock(`Not enough stock for "${product.title}"`);
    return {
      productId: id,
      title: product.title,
      unitPrice: Number(product.price.toString()),
      unitCost: product.costPrice ? Number(product.costPrice.toString()) : null,
      quantity,
      taxable: product.taxable !== false,
    };
  });

  const subtotalCents = lines.reduce((sum, l) => sum + Math.round(l.unitPrice * 100) * l.quantity, 0);
  const discount: ResolvedDiscount | null = discountCode
    ? await discountService.resolve(prisma, storeId, discountCode, subtotalCents, { excludeCartKey: key })
    : null;

  return { key, tenant, lines, subtotalCents, discount };
}

async function priceWithShipping(storeId: string, owner: CartOwner, input: { discountCode?: string; shippingZoneId?: string }) {
  const { key, tenant, lines, subtotalCents, discount } = await priceCart(storeId, owner, input.discountCode);

  let shipping: { name: string; amount: number } | undefined;
  if (input.shippingZoneId) {
    const zone = await prisma.shippingZone.findFirst({ where: { id: input.shippingZoneId, tenantId: storeId } });
    if (!zone) throw Errors.notFound("Shipping zone");
    shipping = { name: zone.name, amount: Number(zone.rateAmount.toString()) };
  }

  const totals = calculateTotals({
    lines,
    discount: discount ? { type: discount.type, value: discount.value } : null,
    shippingAmount: shipping?.amount,
    taxRatePercent: Number(tenant.taxRate.toString()),
  });
  const snapshot: OrderSnapshot = { lines, totals };
  return { key, tenant, snapshot, discount, shipping };
}

const subjectFrom = (input: PlaceLocalOrderInput, total: number, itemCount: number, customerId: string | null): CodRiskSubject => ({
  orderTotal: total,
  itemCount,
  phone: input.phone,
  shippingName: input.name,
  addressLine1: input.address.line1,
  addressCity: input.address.city,
  customerId,
  guestEmail: input.email ?? null,
});

export const localCheckoutService = {
  /**
   * What this store offers a shopper for this cart: which methods are on, and for cash on delivery
   * whether this particular order may use it. The shopper is never shown the risk score or the
   * reasons behind it, only whether the option is there.
   */
  async options(storeId: string, owner: CartOwner, input: PlaceLocalOrderInput) {
    const { tenant, snapshot } = await priceWithShipping(storeId, owner, input);
    const settings = await paymentsService.getSettings(storeId);
    const total = Number(snapshot.totals.total);
    const customerId = await customerIdFor(storeId, owner, input.email);
    const cod = await paymentsService.codOffer(storeId, subjectFrom(input, total, snapshot.lines.length, customerId));

    return {
      currency: tenant.currency,
      total,
      cod: cod.available
        ? { available: true, advanceAmount: cod.advanceAmount, note: "reason" in cod ? cod.reason : null }
        : { available: false, note: cod.reason },
      bankTransfer: settings.bankTransferEnabled
        ? {
            available: true,
            accountName: settings.bankAccountName,
            accountNumber: settings.bankAccountNumber,
            bankName: settings.bankName,
            instructions: settings.bankInstructions,
          }
        : { available: false },
    };
  },

  /**
   * Places the order. The method decides only how the money is recorded: the order, its items, the
   * stock and the discount are written exactly as any other order, by the one createOrder.
   */
  async place(storeId: string, owner: CartOwner, input: PlaceLocalOrderInput) {
    const { key, tenant, snapshot, discount } = await priceWithShipping(storeId, owner, input);
    const total = Number(snapshot.totals.total);
    const customerId = await customerIdFor(storeId, owner, input.email);
    const settings = await paymentsService.getSettings(storeId);

    if (input.method === "cod") {
      if (!settings.codEnabled) throw Errors.validation("This store does not offer cash on delivery.");
    } else if (!settings.bankTransferEnabled) {
      throw Errors.validation("This store does not accept bank transfers.");
    }

    // Cash on delivery is scored again here, not trusted from the options call: a shopper could
    // otherwise ask for the options with a good phone number and then place the order with a bad one.
    let assessment: Awaited<ReturnType<typeof paymentsService.assessCod>> | null = null;
    let outcome = "allowed";
    if (input.method === "cod") {
      const offer = await paymentsService.codOffer(storeId, subjectFrom(input, total, snapshot.lines.length, customerId));
      if (!offer.available) throw Errors.validation(offer.reason);
      assessment = offer.assessment ?? null;
      outcome = offer.outcome ?? "allowed";
    }

    const order = await createOrder({
      tenantId: storeId,
      channel: "ONLINE",
      customerId: customerId ?? undefined,
      guestEmail: input.email ?? undefined,
      shipping: {
        name: input.name,
        // The phone goes with the address because that is what it is for: the courier calls it.
        address: { ...input.address, line2: input.address.line2 ?? null, state: input.address.state ?? null, postalCode: input.address.postalCode ?? null, phone: input.phone },
      },
      snapshot,
      discountCodeId: discount?.codeId,
      // The shopper has not paid yet, so a code whose last use went elsewhere in the meantime must
      // refuse the order rather than be honoured: that is "strict", the same as an in-store sale.
      redeem: "strict",
      status: "PENDING",
      payments: [{ method: input.method === "cod" ? "COD" : "BANK_TRANSFER", amount: total, status: "PENDING" }],
    });

    if (assessment) await paymentsService.recordAssessment(storeId, assessment, outcome, order.id);

    // The cart is the shopper's, and the order now holds the stock.
    await getRedis().del(key);

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      total,
      currency: tenant.currency,
      method: input.method,
      ...(input.method === "bank_transfer"
        ? {
            payTo: {
              accountName: settings.bankAccountName,
              accountNumber: settings.bankAccountNumber,
              bankName: settings.bankName,
              instructions: settings.bankInstructions,
            },
          }
        : {}),
    };
  },
};

/** The store's customer record for this shopper, when there is one. Never creates one here. */
async function customerIdFor(storeId: string, owner: CartOwner, email?: string | null): Promise<string | null> {
  if (owner.kind === "user") {
    const byUser = await prisma.customer.findFirst({ where: { tenantId: storeId, userId: owner.id }, select: { id: true } });
    if (byUser) return byUser.id;
  }
  if (email) {
    const byEmail = await prisma.customer.findFirst({ where: { tenantId: storeId, email }, select: { id: true } });
    if (byEmail) return byEmail.id;
  }
  return null;
}

