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

  /** Signed-in shoppers only: takes the guest cart named in X-Guest-Session-Id into their own. */
  merge: (async (req, res, next) => {
    try {
      if (req.cartOwner?.kind !== "user") return next(Errors.unauthorized("Sign in to merge a guest cart"));
      const guest = req.headers["x-guest-session-id"];
      if (typeof guest !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(guest)) {
        return next(Errors.validation("Send the guest cart's X-Guest-Session-Id header (16 to 64 URL-safe characters)"));
      }
      res.status(200).json(await cartService.mergeGuestCart(req.params.storeId, req.cartOwner, guest));
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
