import { Types } from "mongoose";
import { prisma } from "../../lib/prisma";
import { Product } from "../../models/Product.model";
import { Errors } from "../../errors/AppError";
import { inventoryService } from "../inventory/inventory.service";
import { calculateTotals, PricingDiscount } from "./pricing.service";

export type OrderChannel = "ONLINE" | "POS";
export type OrderPaymentMethod = "CASH" | "CARD" | "STRIPE" | "OTHER";

export interface CreateOrderInput {
  tenantId: string;
  channel: OrderChannel;
  /** Defaults to the tenant's default location. */
  locationId?: string;
  /** POS only: the user who rang up the sale. */
  cashierUserId?: string;
  customerId?: string;
  guestEmail?: string;
  items: { productId: string; quantity: number }[];
  /** Already validated by the discount module; this only applies it. */
  discount?: (PricingDiscount & { discountCodeId?: string }) | null;
  shippingAmount?: number;
  /** Payments already taken. Must add up to the order total exactly. */
  payments: { method: OrderPaymentMethod; amount: number; stripePaymentIntentId?: string }[];
  stripeCheckoutSessionId?: string;
}

/**
 * The one place orders are created, for every sales channel. Online checkout (via the
 * Stripe webhook) and the POS both call this; only the code in front of it differs.
 *
 * Prices, tax and stock are all decided here from server-side data. The caller supplies
 * only product ids and quantities, never prices, so a tampered client cannot change what
 * is charged. Everything below runs in one database transaction: if stock is short or
 * payments do not match the total, nothing is written (no order, no stock change, and the
 * order number is not consumed).
 *
 * Callers must run inside tenantContext.run(tenantId, ...) so the tenant-scoping layer
 * can verify every query.
 */
export async function createOrder(input: CreateOrderInput) {
  if (input.items.length === 0) throw Errors.validation("An order needs at least one item");
  for (const item of input.items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw Errors.validation("Item quantity must be a positive whole number");
    }
    if (!Types.ObjectId.isValid(item.productId)) throw Errors.notFound("Product");
  }

  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const products = await Product.find({ storeId: input.tenantId, _id: { $in: productIds } });
  const byId = new Map(products.map((p) => [p._id.toString(), p]));
  for (const id of productIds) {
    if (!byId.has(id)) throw Errors.notFound("Product");
  }

  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { id: input.tenantId } });
    if (!tenant) throw Errors.notFound("Store");

    const locationId =
      input.locationId ?? (await inventoryService.getDefaultLocationId(tx, input.tenantId));

    const lines = input.items.map((item) => {
      const product = byId.get(item.productId)!;
      return {
        productId: item.productId,
        title: product.title,
        unitPrice: Number(product.price.toString()),
        unitCost: product.costPrice ? Number(product.costPrice.toString()) : null,
        quantity: item.quantity,
        taxable: product.taxable !== false,
      };
    });

    const totals = calculateTotals({
      lines,
      discount: input.discount ?? null,
      shippingAmount: input.shippingAmount,
      taxRatePercent: Number(tenant.taxRate.toString()),
    });

    const paidCents = input.payments.reduce((sum, p) => sum + Math.round(p.amount * 100), 0);
    if (paidCents !== totals.totalCents) {
      throw Errors.validation(
        `Payments (${(paidCents / 100).toFixed(2)}) must equal the order total (${totals.total})`
      );
    }

    // Incrementing (not reading) the counter takes a row lock, so two concurrent orders
    // can never be issued the same number.
    const { orderCounter } = await tx.tenant.update({
      where: { id: input.tenantId },
      data: { orderCounter: { increment: 1 } },
      select: { orderCounter: true },
    });

    const order = await tx.order.create({
      data: {
        tenantId: input.tenantId,
        orderNumber: orderCounter,
        channel: input.channel,
        locationId,
        cashierUserId: input.cashierUserId,
        customerId: input.customerId,
        guestEmail: input.guestEmail,
        status: input.channel === "POS" ? "COMPLETED" : "PAID",
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxAmount: totals.taxAmount,
        shippingAmount: totals.shippingAmount,
        total: totals.total,
        currency: tenant.currency,
        discountCodeId: input.discount?.discountCodeId,
        stripeCheckoutSessionId: input.stripeCheckoutSessionId,
      },
    });

    await tx.orderItem.createMany({
      data: lines.map((line, i) => ({
        orderId: order.id,
        productId: line.productId,
        productTitleSnapshot: line.title,
        unitPrice: line.unitPrice.toFixed(2),
        unitCostSnapshot: line.unitCost === null ? null : line.unitCost.toFixed(2),
        quantity: line.quantity,
        lineTotal: totals.lineTotals[i],
      })),
    });

    await tx.payment.createMany({
      data: input.payments.map((p) => ({
        tenantId: input.tenantId,
        orderId: order.id,
        method: p.method,
        stripePaymentIntentId: p.stripePaymentIntentId,
        amount: p.amount.toFixed(2),
        currency: tenant.currency,
        status: "SUCCEEDED" as const,
      })),
    });

    await inventoryService.deduct(tx, {
      tenantId: input.tenantId,
      locationId,
      orderId: order.id,
      items: input.items,
      userId: input.cashierUserId,
    });

    return order;
  });
}
