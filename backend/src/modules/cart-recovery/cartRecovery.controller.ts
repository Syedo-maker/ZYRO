import { RequestHandler } from "express";
import { cartRecoveryService } from "./cartRecovery.service";

export const cartRecoveryController = {
  performance: (async (req, res, next) => {
    try {
      res.status(200).json(await cartRecoveryService.performance(req.params.storeId));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,
};
