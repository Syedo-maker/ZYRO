import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { aiController } from "./ai.controller";

// Mounted at /stores/:storeId/ai-usage; see app.ts. Same permission as generating AI content
// itself (Implementation_Plan.md Phase 4), since remaining quota only matters to whoever can
// spend it.
export const aiRouter = Router({ mergeParams: true });

aiRouter.get("/", requireAuth, withTenantContext, requirePermission("PRODUCTS_WRITE"), aiController.getUsage);
