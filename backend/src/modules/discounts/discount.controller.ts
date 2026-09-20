import { RequestHandler } from "express";
import { Errors } from "../../errors/AppError";
import { discountService } from "./discount.service";
import { createDiscountSchema, updateDiscountSchema, validateDiscountSchema } from "./discount.validation";
import { cartKey } from "../cart/cart.service";

export const discountController = {
  list: (async (req, res, next) => {
    try {
      res.status(200).json(await discountService.list(req.params.storeId));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  create: (async (req, res, next) => {
    const parsed = createDiscountSchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));
    try {
      res.status(201).json(await discountService.create(req.params.storeId, parsed.data));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  update: (async (req, res, next) => {
    const parsed = updateDiscountSchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));
    try {
      res.status(200).json(await discountService.update(req.params.storeId, req.params.codeId, parsed.data));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  validate: (async (req, res, next) => {
    const parsed = validateDiscountSchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));
    try {
      const key = req.cartOwner ? cartKey(req.params.storeId, req.cartOwner) : undefined;
      res.status(200).json(await discountService.validate(req.params.storeId, parsed.data.code, parsed.data.cartTotal, key));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,
};
