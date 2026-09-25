import { RequestHandler } from "express";
import { z } from "zod";
import { recommendationService } from "./recommendation.service";
import { Errors } from "../../errors/AppError";

const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(12).optional().default(4) });

export const recommendationController = {
  forProduct: (async (req, res, next) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));
    try {
      const data = await recommendationService.forProduct(req.params.storeId, req.params.productId, parsed.data.limit);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,
};
