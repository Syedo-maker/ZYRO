import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { ideasController } from "./ideas.controller";

/**
 * Mounted at /stores/:storeId/product-ideas. Writing a listing is part of adding a product, so this
 * takes the same permission as creating one: a shopper or a staff member without PRODUCTS_WRITE is
 * refused here by the server, whatever the browser shows them.
 */
export const ideasRouter = Router({ mergeParams: true });
const manage = [requireAuth, withTenantContext, requirePermission("PRODUCTS_WRITE")];

ideasRouter.post("/", ...manage, ideasController.suggest);
ideasRouter.get("/keywords", ...manage, ideasController.keywords);
