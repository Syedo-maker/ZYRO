import type { Prisma } from "@prisma/client";
import { toApi } from "./order.rules";

export const orderInclude = {
  items: true,
  payments: true,
  refunds: true,
  returns: { include: { items: true }, orderBy: { createdAt: "asc" } },
  shipment: true,
  customer: true,
  discountCode: true,
} satisfies Prisma.OrderInclude;

export type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d.toString()));

/** The Order shape in openapi.yaml: numbers for money, lowercase enums. */
export function toOrderView(o: OrderWithRelations) {
  return {
    id: o.id,
    storeId: o.tenantId,
    orderNumber: o.orderNumber,
    channel: toApi(o.channel),
    status: toApi(o.status),
    locationId: o.locationId,
    cashierUserId: o.cashierUserId,
    shiftId: o.shiftId,
    discountReason: o.discountReason,
    /** The code the shopper used, when the order was placed with one. */
    discountCode: o.discountCode?.code ?? null,
    customerId: o.customerId,
    customer: o.customer ? { name: o.customer.name, email: o.customer.email } : null,
    guestEmail: o.guestEmail,
    shippingName: o.shippingName,
    shippingAddress: o.shippingAddress,
    subtotal: num(o.subtotal),
    discountAmount: num(o.discountAmount),
    taxAmount: num(o.taxAmount),
    shippingAmount: num(o.shippingAmount),
    total: num(o.total),
    currency: o.currency,
    items: o.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productTitleSnapshot: i.productTitleSnapshot,
      unitPrice: num(i.unitPrice),
      quantity: i.quantity,
      returnedQuantity: i.returnedQuantity,
      lineTotal: num(i.lineTotal),
    })),
    payments: o.payments.map((p) => ({
      id: p.id,
      method: toApi(p.method),
      amount: num(p.amount),
      tenderedAmount: num(p.tenderedAmount),
      changeGiven: p.tenderedAmount === null ? null : Number((Number(p.tenderedAmount.toString()) - Number(p.amount.toString())).toFixed(2)),
      status: toApi(p.status),
    })),
    returns: o.returns.map((r) => ({
      id: r.id,
      amount: num(r.amount),
      method: toApi(r.method),
      reason: r.reason,
      restocked: r.restocked,
      createdByUserId: r.createdByUserId,
      createdAt: r.createdAt,
      items: r.items.map((ri) => ({
        orderItemId: ri.orderItemId,
        productId: ri.productId,
        productTitleSnapshot: ri.productTitleSnapshot,
        quantity: ri.quantity,
        amount: num(ri.amount),
      })),
    })),
    refunds: o.refunds.map((r) => ({
      id: r.id,
      paymentId: r.paymentId,
      amount: num(r.amount),
      method: toApi(r.method),
      reason: r.reason,
      restocked: r.restocked,
      createdAt: r.createdAt,
    })),
    shipment: o.shipment
      ? {
          carrier: o.shipment.carrier,
          trackingNumber: o.shipment.trackingNumber,
          status: toApi(o.shipment.status),
          shippedAt: o.shipment.shippedAt,
          deliveredAt: o.shipment.deliveredAt,
        }
      : null,
    createdAt: o.createdAt,
  };
}
