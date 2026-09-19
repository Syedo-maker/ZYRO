import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { shippingController } from "./shipping.controller";

// Mounted at /stores/:storeId/shipping-zones; see app.ts.
export const shippingRouter = Router({ mergeParams: true });

// Public: the storefront shows the shipping options (name and rate) before checkout.
shippingRouter.get("/", withTenantContext, shippingController.list);

shippingRouter.post("/", requireAuth, withTenantContext, requirePermission("ORDERS_WRITE"), shippingController.create);
shippingRouter.put("/:zoneId", requireAuth, withTenantContext, requirePermission("ORDERS_WRITE"), shippingController.update);
shippingRouter.delete("/:zoneId", requireAuth, withTenantContext, requirePermission("ORDERS_WRITE"), shippingController.remove);
