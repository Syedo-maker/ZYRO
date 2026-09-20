import { Types } from "mongoose";
import { prisma, PrismaTx } from "../../lib/prisma";
import { Product } from "../../models/Product.model";
import { Errors } from "../../errors/AppError";
import { inventoryService } from "../inventory/inventory.service";
import { discountService } from "../discounts/discount.service";
import { calculateTotals, PricingDiscount, PricingResult } from "./pricing.service";

export type OrderChannel = "ONLINE" | "POS";
export type OrderPaymentMethod = "CASH" | "CARD" | "STRIPE" | "OTHER";

export interface PricedLine {
  productId: string;
  title: string;
  unitPrice: number;
  unitCost: number | null;
  quantity: number;
  taxable: boolean;
}

/** A priced cart frozen earlier (online checkout); the order is written exactly as priced. */
export interface OrderSnapshot {
  lines: PricedLine[];
  totals: PricingResult;
}

export interface ShippingAddress {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}

export interface CreateOrderInput {
  tenantId: string;
  channel: OrderChannel;
  /** Defaults to the tenant's default location. */
  locationId?: string;
  /** POS only: the user who rang up the sale. */
  cashierUserId?: string;
  /** POS only: the open register shift, why a manual discount was given, and a retry key. */
  shiftId?: string;
  discountReason?: string;
  clientRequestId?: string;
  customerId?: string;
  guestEmail?: string;
  /** Where an online order ships. */
  shipping?: { name?: string | null; address: ShippingAddress };
  /** Product ids and quantities. Ignored when `snapshot` is given. */
  items?: { productId: string; quantity: number }[];
  /**
   * Use a snapshot taken at checkout instead of pricing from the live catalog. Online
   * orders need this: the shopper already paid the snapshot's total, so the order must
   * match it even if prices or tax changed since.
   */
  snapshot?: OrderSnapshot;
  /** Already validated by the discount module; this only applies it. Live pricing only. */
  discount?: (PricingDiscount & { discountCodeId?: string }) | null;
  /**
   * The discount code this order redeems (works with a snapshot too, whose totals already
   * include the discount). The use is counted in the same transaction that writes the order:
   * `strict` refuses the order if the code is no longer usable (in-store sales), `honour`
   * always records it (online orders, already paid at the discounted price). Defaults to strict.
   */
  discountCodeId?: string;
  redeem?: "strict" | "honour";
  /** Live pricing only. */
  shippingAmount?: number;
  /** Payments already taken. Must add up to the order total exactly. */
  payments: {
    method: OrderPaymentMethod;
    amount: number;
    /** Cash only: what the customer handed over (change is this minus `amount`). */
    tenderedAmount?: number;
    stripePaymentIntentId?: string;
  }[];
  stripeCheckoutSessionId?: string;
}

/**
 * Prices the items from the live catalog and the tenant's tax settings. Also what the POS
 * register calls to show live totals, so what it shows is exactly what createOrder charges.
 */
export async function priceFromCatalog(
  input: Pick<CreateOrderInput, "tenantId" | "items" | "discount" | "shippingAmount">,
  tenantTaxRate: number
): Promise<OrderSnapshot> {
  const items = input.items ?? [];
  if (items.length === 0) throw Errors.validation("An order needs at least one item");
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw Errors.validation("Item quantity must be a positive whole number");
    }
    if (!Types.ObjectId.isValid(item.productId)) throw Errors.notFound("Product");
  }

  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await Product.find({ storeId: input.tenantId, _id: { $in: productIds } });
  const byId = new Map(products.map((p) => [p._id.toString(), p]));
  for (const id of productIds) {
    if (!byId.has(id)) throw Errors.notFound("Product");
  }

  const lines: PricedLine[] = items.map((item) => {
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
    taxRatePercent: tenantTaxRate,
  });
  return { lines, totals };
}

/**
 * The one place orders are created, for every sales channel. Online checkout (via the
 * Stripe webhook) and the POS both call this; only the code in front of it differs.
 *
 * With live pricing, the caller supplies only product ids and quantities, never prices,
 * so a tampered client cannot change what is charged. Everything runs in one database
 * transaction: if stock is short or payments do not match the total, nothing is written
 * (no order, no stock change, and the order number is not consumed). Pass `outerTx` to
 * make the order part of a larger transaction (the webhook uses this to claim the
 * checkout record and create the order atomically).
 *
 * Callers must run inside tenantContext.run(tenantId, ...) so the tenant-scoping layer
 * can verify every query.
 */
export async function createOrder(input: CreateOrderInput, outerTx?: PrismaTx) {
  // Catalog lookups happen before the transaction opens, so no row locks are held while
  // waiting on MongoDB. With a snapshot there is nothing to look up.
  const tenantPreview = input.snapshot
    ? null
    : await prisma.tenant.findUnique({ where: { id: input.tenantId } });
  if (!input.snapshot && !tenantPreview) throw Errors.notFound("Store");
  const priced =
    input.snapshot ?? (await priceFromCatalog(input, Number(tenantPreview!.taxRate.toString())));

  const run = async (tx: PrismaTx) => {
    const tenant = await tx.tenant.findUnique({ where: { id: input.tenantId } });
    if (!tenant) throw Errors.notFound("Store");

    const locationId =
      input.locationId ?? (await inventoryService.getDefaultLocationId(tx, input.tenantId));

    const { lines, totals } = priced;

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
        shiftId: input.shiftId,
        discountReason: input.discountReason,
        clientRequestId: input.clientRequestId,
        customerId: input.customerId,
        guestEmail: input.guestEmail,
        shippingName: input.shipping?.name ?? undefined,
        shippingAddress: input.shipping ? { ...input.shipping.address } : undefined,
        status: input.channel === "POS" ? "COMPLETED" : "PAID",
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        taxAmount: totals.taxAmount,
        shippingAmount: totals.shippingAmount,
        total: totals.total,
        currency: tenant.currency,
        discountCodeId: input.discountCodeId ?? input.discount?.discountCodeId,
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
        tenderedAmount: p.tenderedAmount === undefined ? undefined : p.tenderedAmount.toFixed(2),
        currency: tenant.currency,
        status: "SUCCEEDED" as const,
      })),
    });

    if (input.discountCodeId) {
      await discountService.redeem(tx, { tenantId: input.tenantId, codeId: input.discountCodeId, mode: input.redeem ?? "strict" });
    }

    await inventoryService.deduct(tx, {
      tenantId: input.tenantId,
      locationId,
      orderId: order.id,
      items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      userId: input.cashierUserId,
    });

    return order;
  };

  return outerTx ? run(outerTx) : prisma.$transaction(run);
}
