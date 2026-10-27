import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { categoryController } from "./category.controller";

// Mounted at /stores/:storeId/categories; see app.ts.
export const categoryRouter = Router({ mergeParams: true });

// Whoever may edit products may manage the categories they go in: the owner, or staff with
// products_write. Shoppers never call these; the storefront reads category names from the products.
const manage = [requireAuth, withTenantContext, requirePermission("PRODUCTS_WRITE")];
categoryRouter.get("/", ...manage, categoryController.list);
categoryRouter.post("/", ...manage, categoryController.create);
categoryRouter.patch("/:categoryId", ...manage, categoryController.update);
categoryRouter.delete("/:categoryId", ...manage, categoryController.remove);
