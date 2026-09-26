import { RequestHandler, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { requireSuperAdmin } from "../../middleware/requireSuperAdmin.middleware";
import { Errors } from "../../errors/AppError";
import { platformService } from "./platform.service";

// Mounted at /platform (see app.ts). Super administrators only; per-store totals, no customer data.
export const platformRouter = Router();
platformRouter.use(requireAuth, requireSuperAdmin);

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

const summary: RequestHandler = async (_req, res, next) => {
  try {
    res.status(200).json(await platformService.summary());
  } catch (err) {
    next(err);
  }
};

const tenants: RequestHandler = async (req, res, next) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) return next(Errors.validation(parsed.error.issues.map((i) => i.message).join("; ")));
  try {
    res.status(200).json(await platformService.tenants(parsed.data));
  } catch (err) {
    next(err);
  }
};

platformRouter.get("/summary", summary);
platformRouter.get("/tenants", tenants);
