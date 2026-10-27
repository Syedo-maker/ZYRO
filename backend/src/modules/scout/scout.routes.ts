import { RequestHandler, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { Errors } from "../../errors/AppError";
import { getProductScoutQueue } from "../../lib/productScoutQueue";
import { scoutService } from "./scout.service";

const query = z.object({
  period: z.coerce.number().refine((n) => n === 7 || n === 30, "period is 7 or 30").optional().default(7),
  category: z.string().trim().min(1).max(80).optional(),
});

/**
 * Mounted at /stores/:storeId/product-scout (app.ts). Products permission: the owner and Managers
 * (lib/staffRoles.ts); a Cashier is refused. The trends themselves are platform-wide, but what a
 * store receives is only the anonymised snapshot for its own market.
 */
export const storeScoutRouter = Router({ mergeParams: true });

const forStore: RequestHandler = async (req, res, next) => {
  const parsed = query.safeParse(req.query);
  if (!parsed.success) return next(Errors.validation(parsed.error.issues.map((i) => i.message).join("; ")));
  try {
    res.status(200).json(await scoutService.forStore(req.params.storeId, { period: parsed.data.period as 7 | 30, category: parsed.data.category }));
  } catch (err) {
    next(err);
  }
};
storeScoutRouter.get("/", requireAuth, withTenantContext, requirePermission("PRODUCTS_WRITE"), forStore);

/** Mounted under /platform/product-scout, behind the platform router's super-administrator check. */
export const platformScoutRouter = Router();
platformScoutRouter.post("/refresh", async (_req, res, next) => {
  try {
    // Queued, not run in the request: the run reads every store's orders and calls the AI.
    await getProductScoutQueue().add("refresh", {}, { removeOnComplete: { count: 20 }, removeOnFail: { count: 20 } });
    res.status(202).json({ queued: true });
  } catch (err) {
    next(err);
  }
});
