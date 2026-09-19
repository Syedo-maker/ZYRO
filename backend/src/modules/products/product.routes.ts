import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { productController } from "./product.controller";

// Mounted at /stores/:storeId/products; see app.ts.
export const productRouter = Router({ mergeParams: true });

// Public browsing/search: no auth (openapi.yaml: security: []). Tenant context is still
// needed because stock comes from the tenant-scoped inventory tables in Postgres.
productRouter.get("/", withTenantContext, productController.list);
productRouter.get("/:productId", withTenantContext, productController.get);

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
