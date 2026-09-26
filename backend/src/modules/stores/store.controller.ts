import { RequestHandler } from "express";
import { storeService } from "./store.service";
import { updateBrandingSchema, updateDomainSchema } from "./store.validation";
import { Errors } from "../../errors/AppError";

export const storeController = {
  get: (async (req, res, next) => {
    try {
      const store = await storeService.getPublicProfile(req.params.storeId);
      res.status(200).json(store);
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  updateDomain: (async (req, res, next) => {
    const parsed = updateDomainSchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.issues.map((i) => i.message).join("; ")));
    try {
      res.status(200).json(await storeService.updateDomain(req.params.storeId, parsed.data));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  updateBranding: (async (req, res, next) => {
    const parsed = updateBrandingSchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));

    try {
      const store = await storeService.updateBranding(req.params.storeId, parsed.data);
      res.status(200).json(store);
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,
};
