import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { shippingController } from "./shipping.controller";

// Mounted at /stores/:storeId/shipping-zones; see app.ts.
export const shippingRouter = Router({ mergeParams: true });

// Public: the storefront shows the shipping options (name and rate) before checkout.
shippingRouter.get("/", withTenantContext, shippingController.list);
// The admin's list, for whoever manages orders (owner, or staff with orders_write): the Orders page
// reads this one, so staff without the permission (a cashier) are refused here, as for every other
// part of that page. The public list above stays, because checkout needs it.
shippingRouter.get("/manage", requireAuth, withTenantContext, requirePermission("ORDERS_WRITE"), shippingController.list);

shippingRouter.post("/", requireAuth, withTenantContext, requirePermission("ORDERS_WRITE"), shippingController.create);
shippingRouter.put("/:zoneId", requireAuth, withTenantContext, requirePermission("ORDERS_WRITE"), shippingController.update);
shippingRouter.delete("/:zoneId", requireAuth, withTenantContext, requirePermission("ORDERS_WRITE"), shippingController.remove);
