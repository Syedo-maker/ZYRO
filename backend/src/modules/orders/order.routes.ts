import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { orderController } from "./order.controller";

// Mounted at /stores/:storeId/orders; see app.ts.
export const orderRouter = Router({ mergeParams: true });

orderRouter.use(requireAuth, withTenantContext);

orderRouter.get("/", requirePermission("ORDERS_WRITE"), orderController.list);
// No permission middleware here: the service lets the merchant side see any order and a
// shopper see only their own.
orderRouter.get("/:orderId", orderController.get);
orderRouter.patch("/:orderId/status", requirePermission("ORDERS_WRITE"), orderController.updateStatus);
orderRouter.post("/:orderId/refund", requirePermission("REFUNDS"), orderController.refund);
orderRouter.put("/:orderId/shipment", requirePermission("ORDERS_WRITE"), orderController.upsertShipment);
