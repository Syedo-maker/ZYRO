import { RequestHandler } from "express";
import { Errors } from "../../errors/AppError";
import { aiContentService } from "./ai-content.service";
import { marketingCopySchema, updateDraftSchema } from "./ai-content.validation";

export const aiContentController = {
  getDraft: (async (req, res, next) => {
    try {
      const draft = await aiContentService.getDraft(req.params.storeId, req.params.productId);
      res.status(200).json(draft);
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  generateDescription: (async (req, res, next) => {
    try {
      res.status(202).json(await aiContentService.generateDescription(req.params.storeId, req.params.productId));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  updateDraft: (async (req, res, next) => {
    const parsed = updateDraftSchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));
    try {
      res.status(200).json(await aiContentService.updateDraft(req.params.storeId, req.params.productId, parsed.data.content));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  regenerateDescription: (async (req, res, next) => {
    try {
      res.status(202).json(await aiContentService.regenerateDescription(req.params.storeId, req.params.productId));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  publishDescription: (async (req, res, next) => {
    try {
      res.status(200).json(await aiContentService.publishDescription(req.params.storeId, req.params.productId));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  autoTag: (async (req, res, next) => {
    try {
      res.status(200).json(await aiContentService.autoTag(req.params.storeId, req.params.productId));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  generateSeoMetadata: (async (req, res, next) => {
    try {
      res.status(200).json(await aiContentService.generateSeoMetadata(req.params.storeId, req.params.productId));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  generateMarketingCopy: (async (req, res, next) => {
    const parsed = marketingCopySchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));
    try {
      res.status(200).json(await aiContentService.generateMarketingCopy(req.params.storeId, req.params.productId, parsed.data));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  // Review summary routes are mounted in review.routes.ts (this product's reviews sub-router),
  // calling aiContentService directly, since that file already uses a lightweight route()
  // wrapper against services rather than a separate controller.
};
