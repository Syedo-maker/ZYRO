import { RequestHandler } from "express";
import { z } from "zod";
import { EXPERIENCES, meService } from "./me.service";
import { Errors } from "../../errors/AppError";

const preferenceSchema = z.object({ experience: z.enum(EXPERIENCES) });

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

  /** Issue 2: remembers "shop" or "start a store" from the landing screen. A hint, not a role. */
  setPreference: (async (req, res, next) => {
    const parsed = preferenceSchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));
    try {
      res.status(200).json(await meService.setPreferredExperience(req.userId!, parsed.data.experience));
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
