import { RequestHandler } from "express";
import { storeService } from "./store.service";
import { updateBrandingSchema, updateCurrencySchema, updateDomainSchema } from "./store.validation";
import { Errors } from "../../errors/AppError";
import { STORE_CURRENCIES } from "../../lib/currencies";

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

  /** Issue 2: does my shop appear at /shop, and if not, why not. */
  getDirectoryListing: (async (req, res, next) => {
    try {
      res.status(200).json(await storeService.directoryListing(req.params.storeId));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  getCurrency: (async (req, res, next) => {
    try {
      const store = await storeService.getPublicProfile(req.params.storeId);
      const lock = await storeService.currencyLock(req.params.storeId);
      res.status(200).json({ currency: store.currency, locked: lock.locked, reason: lock.reason, options: STORE_CURRENCIES.map(({ code, name }) => ({ code, name })) });
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  updateCurrency: (async (req, res, next) => {
    const parsed = updateCurrencySchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation("Choose one of the listed currencies"));
    try {
      res.status(200).json(await storeService.updateCurrency(req.params.storeId, parsed.data));
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
