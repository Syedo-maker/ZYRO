import { RequestHandler } from "express";
import { shippingService } from "./shipping.service";
import { shippingZoneSchema } from "./shipping.validation";
import { Errors } from "../../errors/AppError";

export const shippingController = {
  list: (async (req, res, next) => {
    try {
      res.status(200).json(await shippingService.list(req.params.storeId));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  create: (async (req, res, next) => {
    const parsed = shippingZoneSchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));
    try {
      res.status(201).json(await shippingService.create(req.params.storeId, parsed.data));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  update: (async (req, res, next) => {
    const parsed = shippingZoneSchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));
    try {
      res.status(200).json(await shippingService.update(req.params.storeId, req.params.zoneId, parsed.data));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  remove: (async (req, res, next) => {
    try {
      await shippingService.remove(req.params.storeId, req.params.zoneId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,
};
