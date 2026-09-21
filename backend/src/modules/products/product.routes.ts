import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { productController } from "./product.controller";
import { productReviewsRouter } from "../reviews/review.routes";

// Mounted at /stores/:storeId/products; see app.ts.
export const productRouter = Router({ mergeParams: true });

// Public browsing/search: no auth (openapi.yaml: security: []). Tenant context is still
// needed because stock comes from the tenant-scoped inventory tables in Postgres.
productRouter.get("/", withTenantContext, productController.list);
// "suggest" is registered before "/:productId" so it is never read as a product id.
productRouter.get("/suggest", withTenantContext, productController.suggest);
productRouter.get("/categories", withTenantContext, productController.categories);
productRouter.get("/:productId", withTenantContext, productController.get);
// Reviews of a product: public to read, signed-in shoppers write their own.
productRouter.use("/:productId/reviews", productReviewsRouter);

// withTenantContext runs before requirePermission because that middleware itself reads
// the active tenant context (to look up the caller's StaffMember row) and because product
// writes also touch the tenant-scoped inventory tables.
productRouter.post("/", requireAuth, withTenantContext, requirePermission("PRODUCTS_WRITE"), productController.create);
productRouter.put(
  "/:productId",
  requireAuth,
  withTenantContext,
  requirePermission("PRODUCTS_WRITE"),
  productController.update
);
productRouter.delete(
  "/:productId",
  requireAuth,
  withTenantContext,
  requirePermission("PRODUCTS_WRITE"),
  productController.remove
);
