import { RequestHandler } from "express";
import { checkoutService } from "./checkout.service";
import { createSessionSchema } from "./checkout.validation";
import { Errors } from "../../errors/AppError";

export const checkoutController = {
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
