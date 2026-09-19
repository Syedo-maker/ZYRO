import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { getStripeGateway } from "../../lib/stripe";
import { hasStorePermission } from "../../lib/permissions";
import { Errors } from "../../errors/AppError";
import { inventoryService } from "../inventory/inventory.service";
import { orderInclude, toOrderView } from "./order.presenter";
import {
  INITIAL_SHIPMENT_STATUSES,
  ManualTarget,
  REFUNDABLE,
  SHIPMENT_TRANSITIONS,
} from "./order.rules";
import type { ListOrdersQuery, RefundInput, ShipmentInput } from "./order.validation";

async function loadView(tenantId: string, orderId: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, tenantId }, include: orderInclude });
  if (!order) throw Errors.notFound("Order");
  return toOrderView(order);
}

/**
 * Refunds every successful payment on an order in full and moves the order to its final
 * status. Shared by the refund endpoint and by cancelling a paid order.
 *
 * Order of work matters for safety. Stripe is called first, with an idempotency key per
 * payment, so retrying (after a crash, or a double click) returns the same refund instead
 * of paying out twice. Only then does one database transaction claim the order (a
 * conditional update, so exactly one caller wins), record the refunds, mark the payments,
 * and put stock back. If the Stripe call fails nothing has changed and the caller can retry.
 */
async function refundOrder(
  tenantId: string,
  orderId: string,
  userId: string,
  opts: { reason?: string; restock: boolean; finalStatus: "REFUNDED" | "CANCELLED" }
) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
    include: { payments: true, items: true },
  });
  if (!order) throw Errors.notFound("Order");
  if (!REFUNDABLE.includes(order.status)) {
    throw Errors.conflict(`An order that is ${order.status.toLowerCase()} cannot be refunded`);
  }
  // A whole-order refund pays every payment back in full, which would double-refund the
  // part already returned item by item. The rest of such a sale is returned the same way.
  if (order.items.some((i) => i.returnedQuantity > 0)) {
    throw Errors.conflict("Part of this order was already returned; return the remaining items instead of refunding the whole order");
  }

  const payments = order.payments.filter((p) => p.status === "SUCCEEDED");

  const stripeRefundIds = new Map<string, string>();
  for (const payment of payments) {
    if (payment.method === "STRIPE" && payment.stripePaymentIntentId) {
      const refund = await getStripeGateway().refundPaymentIntent(
        payment.stripePaymentIntentId,
        `refund-order-${order.id}-${payment.id}`
      );
      stripeRefundIds.set(payment.id, refund.id);
    }
  }

  await prisma.$transaction(async (tx) => {
    const claim = await tx.order.updateMany({
      where: { id: order.id, tenantId, status: { in: REFUNDABLE } },
      data: { status: opts.finalStatus },
    });
    if (claim.count === 0) throw Errors.conflict("This order has already been refunded or cancelled");

    // Cash handed back at the counter comes out of whichever drawer is open now.
    const openShift = order.channel === "POS" && order.locationId
      ? await tx.posShift.findFirst({ where: { tenantId, locationId: order.locationId, status: "OPEN" } })
      : null;

    for (const payment of payments) {
      await tx.refund.create({
        data: {
          tenantId,
          orderId: order.id,
          shiftId: openShift?.id,
          paymentId: payment.id,
          amount: payment.amount,
          currency: payment.currency,
          method: payment.method,
          stripeRefundId: stripeRefundIds.get(payment.id),
          reason: opts.reason,
          restocked: opts.restock,
          createdByUserId: userId,
        },
      });
    }
    await tx.payment.updateMany({
      where: { orderId: order.id, tenantId, status: "SUCCEEDED" },
      data: { status: "REFUNDED" },
    });

    if (opts.restock) {
      const locationId = order.locationId ?? (await inventoryService.getDefaultLocationId(tx, tenantId));
      await inventoryService.restock(tx, {
        tenantId,
        locationId,
        orderId: order.id,
        items: order.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        userId,
      });
    }

    // A parcel that has not left yet no longer needs to go.
    await tx.shipment.updateMany({
      where: { orderId: order.id, tenantId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
  });

  return loadView(tenantId, order.id);
}

export const orderManagementService = {
  async list(tenantId: string, q: ListOrdersQuery) {
    const where: Prisma.OrderWhereInput = { tenantId };
    if (q.status) where.status = q.status;
    if (q.channel) where.channel = q.channel;
    if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
    if (q.q) {
      const asNumber = /^\d+$/.test(q.q) ? Number(q.q) : null;
      where.OR = [
        ...(asNumber !== null ? [{ orderNumber: asNumber }] : []),
        { guestEmail: { contains: q.q, mode: "insensitive" as const } },
        { customer: { is: { email: { contains: q.q, mode: "insensitive" as const } } } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: orderInclude,
        orderBy: { createdAt: "desc" },
        skip: q.offset,
        take: q.limit,
      }),
      prisma.order.count({ where }),
    ]);
    return { data: rows.map(toOrderView), pagination: { total, limit: q.limit, offset: q.offset } };
  },

  /**
   * The merchant side (owner, or staff with orders_write) sees any order in the store.
   * Anyone else sees only orders placed by their own customer record; every other order
   * answers 404 rather than 403, so order ids cannot be probed.
   */
  async get(tenantId: string, orderId: string, userId: string) {
    const isMerchant = await hasStorePermission(userId, tenantId, "ORDERS_WRITE");
    const order = await prisma.order.findFirst({
      where: isMerchant ? { id: orderId, tenantId } : { id: orderId, tenantId, customer: { is: { userId } } },
      include: orderInclude,
    });
    if (!order) throw Errors.notFound("Order");
    return toOrderView(order);
  },

  async updateStatus(tenantId: string, orderId: string, target: ManualTarget, userId: string) {
    const order = await prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw Errors.notFound("Order");

    if (target === "FULFILLED") {
      const { count } = await prisma.order.updateMany({
        where: { id: orderId, tenantId, status: "PAID" },
        data: { status: "FULFILLED" },
      });
      if (count === 0) throw Errors.conflict(`Only a paid order can be marked fulfilled (this one is ${order.status.toLowerCase()})`);
      return loadView(tenantId, orderId);
    }

    // CANCELLED
    if (order.status === "PENDING") {
      const { count } = await prisma.order.updateMany({
        where: { id: orderId, tenantId, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      if (count === 0) throw Errors.conflict("The order changed while you were cancelling it; reload and try again");
      return loadView(tenantId, orderId);
    }
    if (order.status !== "PAID") {
      throw Errors.conflict(
        `Only an order that has not shipped can be cancelled (this one is ${order.status.toLowerCase()}); use a refund instead`
      );
    }
    if (!(await hasStorePermission(userId, tenantId, "REFUNDS"))) {
      throw Errors.forbidden("Cancelling a paid order refunds it and requires the REFUNDS permission");
    }
    return refundOrder(tenantId, orderId, userId, { restock: true, finalStatus: "CANCELLED" });
  },

  async refund(tenantId: string, orderId: string, userId: string, input: RefundInput) {
    const order = await prisma.order.findFirst({ where: { id: orderId, tenantId }, select: { status: true } });
    if (!order) throw Errors.notFound("Order");
    // Goods that already left the building are only put back on the shelf if the merchant says so.
    const restock = input.restock ?? order.status === "PAID";
    return refundOrder(tenantId, orderId, userId, { reason: input.reason, restock, finalStatus: "REFUNDED" });
  },

  async upsertShipment(tenantId: string, orderId: string, input: ShipmentInput) {
    const order = await prisma.order.findFirst({ where: { id: orderId, tenantId }, include: { shipment: true } });
    if (!order) throw Errors.notFound("Order");
    if (order.channel !== "ONLINE") {
      throw Errors.conflict("In-store (POS) orders are handed over at the counter and have no shipment");
    }
    if (order.status !== "PAID" && order.status !== "FULFILLED") {
      throw Errors.conflict(`A ${order.status.toLowerCase()} order cannot be shipped`);
    }

    const existing = order.shipment;
    const nextStatus = input.status ?? existing?.status ?? "PENDING";

    if (!existing && !INITIAL_SHIPMENT_STATUSES.includes(nextStatus)) {
      throw Errors.conflict(`A new shipment can start as pending or shipped, not ${nextStatus.toLowerCase()}`);
    }
    if (existing && nextStatus !== existing.status && !SHIPMENT_TRANSITIONS[existing.status].includes(nextStatus)) {
      throw Errors.conflict(`A ${existing.status.toLowerCase()} shipment cannot become ${nextStatus.toLowerCase()}`);
    }

    const now = new Date();
    const data = {
      ...(input.carrier !== undefined ? { carrier: input.carrier } : {}),
      ...(input.trackingNumber !== undefined ? { trackingNumber: input.trackingNumber } : {}),
      status: nextStatus,
      ...(nextStatus === "SHIPPED" && !existing?.shippedAt ? { shippedAt: now } : {}),
      ...(nextStatus === "DELIVERED" ? { deliveredAt: now } : {}),
    };

    try {
      await prisma.$transaction(async (tx) => {
        if (existing) {
          // Conditional on the status we read, so two simultaneous updates cannot both apply.
          const { count } = await tx.shipment.updateMany({
            where: { id: existing.id, tenantId, status: existing.status },
            data,
          });
          if (count === 0) throw Errors.conflict("The shipment changed while you were updating it; reload and try again");
        } else {
          await tx.shipment.create({ data: { tenantId, orderId, ...data } });
        }
        if (nextStatus === "SHIPPED" || nextStatus === "DELIVERED") {
          await tx.order.updateMany({ where: { id: orderId, tenantId, status: "PAID" }, data: { status: "FULFILLED" } });
        }
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw Errors.conflict("This order already has a shipment; reload and try again");
      }
      throw err;
    }
    return loadView(tenantId, orderId);
  },
};
