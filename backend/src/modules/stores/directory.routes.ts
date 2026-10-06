import { Router } from "express";
import { z } from "zod";
import { Errors } from "../../errors/AppError";
import { directoryService } from "./directory.service";

/**
 * Mounted at /stores (see app.ts), before the /stores/:storeId router so "/" and "/categories" are
 * matched here rather than being read as a store id.
 *
 * Public on purpose: a shopper looking for somewhere to buy from has no account yet. Everything
 * returned is information a shop already shows on its own storefront.
 */
export const directoryRouter = Router();

const listQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().positive().max(60).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

directoryRouter.get("/", async (req, res, next) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return next(Errors.validation(parsed.error.message));
  try {
    res.status(200).json(await directoryService.list(parsed.data));
  } catch (err) {
    next(err);
  }
});

directoryRouter.get("/categories", async (_req, res, next) => {
  try {
    res.status(200).json({ categories: await directoryService.categories() });
  } catch (err) {
    next(err);
  }
});
