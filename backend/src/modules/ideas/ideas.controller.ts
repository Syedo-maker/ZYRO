import { RequestHandler } from "express";
import { Errors } from "../../errors/AppError";
import { ideasService } from "./ideas.service";
import { keywordQuerySchema, productIdeaSchema } from "./ideas.validation";

export const ideasController = {
  /** One AI call, four suggestions, one generation off the quota. Saves nothing. */
  suggest: (async (req, res, next) => {
    const parsed = productIdeaSchema.safeParse(req.body ?? {});
    if (!parsed.success) return next(Errors.validation(parsed.error.message));
    try {
      res.status(200).json(await ideasService.suggest(req.params.storeId, parsed.data));
    } catch (err) {
      // A used-up quota arrives here as the orchestrator's 402, which the form shows as a message
      // next to the "Write it myself" option. Nothing else needs special handling.
      next(err);
    }
  }) satisfies RequestHandler,

  /** The keyword list on its own, so the form can show what it knows without spending a generation. */
  keywords: (async (req, res, next) => {
    const parsed = keywordQuerySchema.safeParse(req.query);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));
    try {
      res.status(200).json(await ideasService.keywords(req.params.storeId, parsed.data.category));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,
};
