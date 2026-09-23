import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { aiContentController } from "./ai-content.controller";

// Mounted at /stores/:storeId/products/:productId (see product.routes.ts). Every action here
// spends one AI generation from the tenant's monthly quota (Implementation_Plan.md Phase 4)
// and requires the same permission as editing the product itself.
export const aiContentRouter = Router({ mergeParams: true });
const manage = [requireAuth, withTenantContext, requirePermission("PRODUCTS_WRITE")];

aiContentRouter.get("/ai-description", ...manage, aiContentController.getDraft);
aiContentRouter.post("/ai-description/generate", ...manage, aiContentController.generateDescription);
aiContentRouter.patch("/ai-description", ...manage, aiContentController.updateDraft);
aiContentRouter.post("/ai-description/regenerate", ...manage, aiContentController.regenerateDescription);
aiContentRouter.post("/ai-description/publish", ...manage, aiContentController.publishDescription);
aiContentRouter.post("/auto-tag", ...manage, aiContentController.autoTag);
aiContentRouter.post("/seo-metadata/generate", ...manage, aiContentController.generateSeoMetadata);
