import { RequestHandler, Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { Errors } from "../../errors/AppError";
import { analyticsService, resolveRange } from "./analytics.service";
import { planService } from "../billing/plan.service";
import { summaryQuerySchema } from "./analytics.validation";

// Mounted at /stores/:storeId/analytics; see app.ts. Owner, or staff with analytics_read.
export const analyticsRouter = Router({ mergeParams: true });

const summary: RequestHandler = async (req, res, next) => {
  const parsed = summaryQuerySchema.safeParse(req.query);
  if (!parsed.success) return next(Errors.validation(parsed.error.issues.map((i) => i.message).join("; ")));
  try {
    // The plan decides how long a window one request may cover (Free 30 days, Pro 90, Business 365).
    const { from, to } = resolveRange(parsed.data);
    await planService.assertAnalyticsRange(req.params.storeId, from, to);
    res.status(200).json(await analyticsService.summary(req.params.storeId, parsed.data));
  } catch (err) {
    next(err);
  }
};

analyticsRouter.get("/summary", requireAuth, withTenantContext, requirePermission("ANALYTICS_READ"), summary);
