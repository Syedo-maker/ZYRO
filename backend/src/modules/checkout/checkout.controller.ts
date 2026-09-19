import { RequestHandler } from "express";
import { checkoutService } from "./checkout.service";
import { createSessionSchema, quoteSchema } from "./checkout.validation";
import { Errors } from "../../errors/AppError";

export const checkoutController = {
  quote: (async (req, res, next) => {
    const parsed = quoteSchema.safeParse(req.body ?? {});
    if (!parsed.success) return next(Errors.validation(parsed.error.message));
    try {
      res.status(200).json(await checkoutService.quote(req.params.storeId, req.cartOwner!, parsed.data));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  sessionStatus: (async (req, res, next) => {
    try {
      res.status(200).json(await checkoutService.getSessionStatus(req.params.storeId, req.params.sessionId));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  createSession: (async (req, res, next) => {
    const parsed = createSessionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return next(Errors.validation(parsed.error.message));
    try {
      const result = await checkoutService.createSession(req.params.storeId, req.cartOwner!, parsed.data);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,
};
