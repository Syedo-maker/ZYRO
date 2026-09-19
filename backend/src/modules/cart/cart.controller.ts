import { RequestHandler } from "express";
import { cartService } from "./cart.service";
import { addItemSchema, updateItemSchema } from "./cart.validation";
import { Errors } from "../../errors/AppError";

export const cartController = {
  get: (async (req, res, next) => {
    try {
      res.status(200).json(await cartService.get(req.params.storeId, req.cartOwner!));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  addItem: (async (req, res, next) => {
    const parsed = addItemSchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));
    try {
      const cart = await cartService.addItem(
        req.params.storeId,
        req.cartOwner!,
        parsed.data.productId,
        parsed.data.quantity
      );
      res.status(200).json(cart);
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  updateItem: (async (req, res, next) => {
    const parsed = updateItemSchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));
    try {
      const cart = await cartService.setQuantity(
        req.params.storeId,
        req.cartOwner!,
        req.params.itemId,
        parsed.data.quantity
      );
      res.status(200).json(cart);
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  removeItem: (async (req, res, next) => {
    try {
      res.status(200).json(await cartService.removeItem(req.params.storeId, req.cartOwner!, req.params.itemId));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,
};
