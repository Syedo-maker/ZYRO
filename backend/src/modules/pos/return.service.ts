import type { PaymentMethod } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";
import { inventoryService } from "../inventory/inventory.service";
import { toCents } from "./shift.service";
import { saleService } from "./sale.service";
import type { ReturnInput } from "./pos.validation";

/**
 * The refund for some units of one sale: the units' price, less their share of the sale's
 * discount, plus their share of its tax. Working in cents; the final return of a sale is
 * settled to the exact remainder in the caller so all returns together never differ from
 * what was paid by even one cent.
 */
export function refundForUnits(
  order: { subtotalCents: number; discountCents: number; taxCents: number },
  unitPriceCents: number,
  quantity: number
): number {
  const gross = unitPriceCents * quantity;
  const discountShare = order.subtotalCents > 0 ? Math.round((gross * order.discountCents) / order.subtotalCents) : 0;
  const net = gross - discountShare;
  const taxBase = order.subtotalCents - order.discountCents;
  const taxShare = taxBase > 0 ? Math.round((net * order.taxCents) / taxBase) : 0;
  return net + taxShare;
}

export const returnService = {
  /**
   * Takes some or all of a POS sale's items back, refunds the money, and puts the stock
   * back on the shelf (unless told the goods are damaged). Everything happens in one
   * transaction. The first statement locks the order row, so two returns of the same sale
   * are handled one after the other and the same unit can never be returned twice.
   */
  async create(tenantId: string, orderId: string, userId: string, input: ReturnInput) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId, channel: "POS" },
      include: { items: true, payments: true },
    });
    if (!order) throw Errors.notFound("Sale");
    if (order.status !== "COMPLETED") {
      throw Errors.conflict(`A sale that is ${order.status.toLowerCase()} has nothing left to return`);
    }

    // The same line listed twice is one line with the quantities added.
    const wanted = new Map<string, number>();
    for (const line of input.items) wanted.set(line.orderItemId, (wanted.get(line.orderItemId) ?? 0) + line.quantity);

    const refundMethod: PaymentMethod =
      input.refundMethod ??
      (() => {
        const biggest = [...order.payments].sort((a, b) => toCents(b.amount) - toCents(a.amount))[0];
        return biggest && biggest.method !== "STRIPE" ? biggest.method : "CASH";
      })();
    const restock = input.restock ?? true;

    await prisma.$transaction(async (tx) => {
      // Row lock: concurrent returns of this sale queue up behind this statement.
      const claim = await tx.order.updateMany({
        where: { id: order.id, tenantId, status: "COMPLETED" },
        data: { updatedAt: new Date() },
      });
      if (claim.count === 0) throw Errors.conflict("This sale was refunded while you were working; reload and try again");

      const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
      const byId = new Map(items.map((i) => [i.id, i]));

      const orderMoney = {
        subtotalCents: toCents(order.subtotal),
        discountCents: toCents(order.discountAmount),
        taxCents: toCents(order.taxAmount),
      };

      let amountCents = 0;
      const lines: { item: (typeof items)[number]; quantity: number; cents: number }[] = [];
      for (const [orderItemId, quantity] of wanted) {
        const item = byId.get(orderItemId);
        if (!item) throw Errors.validation("One of the items is not part of this sale");
        const left = item.quantity - item.returnedQuantity;
        if (quantity > left) {
          throw Errors.conflict(
            left === 0
              ? `${item.productTitleSnapshot} has already been returned`
              : `Only ${left} of ${item.productTitleSnapshot} can still be returned`
          );
        }
        const cents = refundForUnits(orderMoney, toCents(item.unitPrice), quantity);
        amountCents += cents;
        lines.push({ item, quantity, cents });
      }

      const prior = await tx.orderReturn.aggregate({ where: { tenantId, orderId: order.id }, _sum: { amount: true } });
      const priorCents = toCents(prior._sum.amount);
      const remainingCents = toCents(order.total) - priorCents;

      // Returning the last units settles to the exact remainder, absorbing any rounding.
      const returnsEverything = items.every((i) => i.returnedQuantity + (wanted.get(i.id) ?? 0) === i.quantity);
      amountCents = returnsEverything ? remainingCents : Math.min(amountCents, remainingCents);

      // Cash goes back out of whichever drawer is open now.
      const openShift = order.locationId
        ? await tx.posShift.findFirst({ where: { tenantId, locationId: order.locationId, status: "OPEN" } })
        : null;

      for (const l of lines) {
        await tx.orderItem.update({ where: { id: l.item.id }, data: { returnedQuantity: { increment: l.quantity } } });
      }
      await tx.orderReturn.create({
        data: {
          tenantId,
          orderId: order.id,
          shiftId: openShift?.id,
          amount: (amountCents / 100).toFixed(2),
          currency: order.currency,
          method: refundMethod,
          reason: input.reason,
          restocked: restock,
          createdByUserId: userId,
          items: {
            create: lines.map((l) => ({
              orderItemId: l.item.id,
              productId: l.item.productId,
              productTitleSnapshot: l.item.productTitleSnapshot,
              quantity: l.quantity,
              amount: (l.cents / 100).toFixed(2),
            })),
          },
        },
      });

      if (restock) {
        const locationId = order.locationId ?? (await inventoryService.getDefaultLocationId(tx, tenantId));
        await inventoryService.restock(tx, {
          tenantId,
          locationId,
          orderId: order.id,
          items: lines.map((l) => ({ productId: l.item.productId, quantity: l.quantity })),
          userId,
        });
      }

      if (returnsEverything) {
        await tx.order.updateMany({ where: { id: order.id, tenantId, status: "COMPLETED" }, data: { status: "REFUNDED" } });
        await tx.payment.updateMany({ where: { orderId: order.id, tenantId, status: "SUCCEEDED" }, data: { status: "REFUNDED" } });
      }
    });

    return saleService.presentSale(tenantId, order.id);
  },
};
