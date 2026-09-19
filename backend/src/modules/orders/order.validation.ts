import { z } from "zod";
import type { OrderStatus, SalesChannel, ShipmentStatus } from "@prisma/client";

// Mirrors the order request shapes in backend/openapi.yaml (lowercase on the wire, uppercase in the database).
const orderStatus = z
  .enum(["pending", "paid", "fulfilled", "completed", "cancelled", "refunded"])
  .transform((v) => v.toUpperCase() as OrderStatus);

export const listOrdersQuerySchema = z.object({
  status: orderStatus.optional(),
  channel: z
    .enum(["online", "pos"])
    .transform((v) => v.toUpperCase() as SalesChannel)
    .optional(),
  /** An order number, or part of a customer email. */
  q: z.string().trim().min(1).max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

export const updateStatusSchema = z.object({ status: orderStatus });

export const refundSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  /** Put the items back in stock. Defaults to yes for an order that has not shipped. */
  restock: z.boolean().optional(),
});
export type RefundInput = z.infer<typeof refundSchema>;

export const shipmentSchema = z
  .object({
    carrier: z.string().trim().max(100).optional(),
    trackingNumber: z.string().trim().max(100).optional(),
    status: z
      .enum(["pending", "shipped", "delivered", "cancelled"])
      .transform((v) => v.toUpperCase() as ShipmentStatus)
      .optional(),
  })
  .refine((v) => v.carrier !== undefined || v.trackingNumber !== undefined || v.status !== undefined, {
    message: "Send at least one of carrier, trackingNumber or status",
  });
export type ShipmentInput = z.infer<typeof shipmentSchema>;
