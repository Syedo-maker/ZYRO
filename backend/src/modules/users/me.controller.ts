import { RequestHandler } from "express";
import { meService } from "./me.service";
import { Errors } from "../../errors/AppError";

export const meController = {
  getProfile: (async (req, res, next) => {
    try {
      const profile = await meService.getProfile(req.userId!);
      if (!profile) return next(Errors.notFound("User"));
      res.status(200).json(profile);
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  listStores: (async (req, res, next) => {
    try {
      const stores = await meService.listMyStores(req.userId!);
      res.status(200).json(stores);
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,
};
