import { RequestHandler } from "express";
import { orderManagementService } from "./order.management.service";
import { listOrdersQuerySchema, refundSchema, shipmentSchema, updateStatusSchema } from "./order.validation";
import { MANUAL_TARGETS, ManualTarget } from "./order.rules";
import { Errors } from "../../errors/AppError";

export const orderController = {
  list: (async (req, res, next) => {
    const parsed = listOrdersQuerySchema.safeParse(req.query);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));
    try {
      res.status(200).json(await orderManagementService.list(req.params.storeId, parsed.data));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  get: (async (req, res, next) => {
    try {
      res.status(200).json(await orderManagementService.get(req.params.storeId, req.params.orderId, req.userId!));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  updateStatus: (async (req, res, next) => {
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));
    const target = parsed.data.status;
    if (!(MANUAL_TARGETS as readonly string[]).includes(target)) {
      return next(
        Errors.validation(
          target === "REFUNDED"
            ? "Use POST /orders/{orderId}/refund to refund an order"
            : "Only fulfilled and cancelled can be set by hand"
        )
      );
    }
    try {
      const order = await orderManagementService.updateStatus(
        req.params.storeId,
        req.params.orderId,
        target as ManualTarget,
        req.userId!
      );
      res.status(200).json(order);
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  refund: (async (req, res, next) => {
    const parsed = refundSchema.safeParse(req.body ?? {});
    if (!parsed.success) return next(Errors.validation(parsed.error.message));
    try {
      const order = await orderManagementService.refund(req.params.storeId, req.params.orderId, req.userId!, parsed.data);
      res.status(200).json(order);
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  upsertShipment: (async (req, res, next) => {
    const parsed = shipmentSchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));
    try {
      res.status(200).json(await orderManagementService.upsertShipment(req.params.storeId, req.params.orderId, parsed.data));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,
};
