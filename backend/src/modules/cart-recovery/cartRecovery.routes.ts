import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { cartRecoveryController } from "./cartRecovery.controller";

// Mounted at /stores/:storeId/cart-recovery; see app.ts.
export const cartRecoveryRouter = Router({ mergeParams: true });

cartRecoveryRouter.get("/performance", requireAuth, withTenantContext, requirePermission("ANALYTICS_READ"), cartRecoveryController.performance);
