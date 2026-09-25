import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { insightsController } from "./insights.controller";

// Mounted at /stores/:storeId/insights; see app.ts. Same permission as the analytics summary,
// since this is that same dashboard's AI-written companion (Implementation_Plan.md Phase 5).
export const insightsRouter = Router({ mergeParams: true });
const manage = [requireAuth, withTenantContext, requirePermission("ANALYTICS_READ")];

insightsRouter.get("/", ...manage, insightsController.get);
insightsRouter.post("/generate", ...manage, insightsController.generate);
