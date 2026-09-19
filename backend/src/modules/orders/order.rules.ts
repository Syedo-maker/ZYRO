import type { OrderStatus, ShipmentStatus } from "@prisma/client";

/**
 * The order lifecycle, in one place.
 *
 *   PENDING   -> CANCELLED
 *   PAID      -> FULFILLED | CANCELLED (refunds and restocks) | REFUNDED
 *   FULFILLED -> REFUNDED
 *   COMPLETED -> REFUNDED            (a finished POS sale)
 *   CANCELLED, REFUNDED are final.
 *
 * Only FULFILLED and CANCELLED can be set by hand (PATCH status). REFUNDED goes through
 * the refund endpoint because it moves money; PAID and COMPLETED are set by createOrder.
 */
export const REFUNDABLE: OrderStatus[] = ["PAID", "FULFILLED", "COMPLETED"];

export const MANUAL_TARGETS = ["FULFILLED", "CANCELLED"] as const;
export type ManualTarget = (typeof MANUAL_TARGETS)[number];

/** What a shipment may move to next. A new shipment may start as PENDING or SHIPPED. */
export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  PENDING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};
export const INITIAL_SHIPMENT_STATUSES: ShipmentStatus[] = ["PENDING", "SHIPPED"];

/** API enums are lowercase (openapi.yaml); the database enums are uppercase. */
export const toApi = (value: string) => value.toLowerCase();
