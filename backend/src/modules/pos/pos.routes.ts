import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { requireOwner } from "../../middleware/requireOwner.middleware";
import { posController } from "./pos.controller";

// Mounted at /stores/:storeId/pos; see app.ts.
// Permissions: the owner passes every check. Staff need pos_sell to work the register,
// refunds to take items back, and analytics_read for the daily summary.
export const posRouter = Router({ mergeParams: true });

posRouter.use(requireAuth, withTenantContext);

const sell = requirePermission("POS_SELL");

posRouter.get("/session", sell, posController.session);
posRouter.put("/settings", requireOwner, posController.updateSettings);

posRouter.get("/products", sell, posController.searchProducts);
posRouter.get("/customers", sell, posController.searchCustomers);
posRouter.post("/customers", sell, posController.createCustomer);

posRouter.get("/shift", sell, posController.currentShift);
posRouter.post("/shift/open", sell, posController.openShift);
posRouter.post("/shift/close", sell, posController.closeShift);

posRouter.post("/quote", sell, posController.quote);
posRouter.post("/sales", sell, posController.createSale);
posRouter.get("/sales", sell, posController.listSales);
posRouter.get("/sales/:orderId", sell, posController.getSale);
posRouter.post("/sales/:orderId/returns", requirePermission("REFUNDS"), posController.createReturn);

posRouter.post("/held", sell, posController.holdSale);
posRouter.get("/held", sell, posController.listHeld);
posRouter.post("/held/:heldId/resume", sell, posController.resumeHeld);
posRouter.delete("/held/:heldId", sell, posController.discardHeld);

posRouter.get("/reports/daily", requirePermission("ANALYTICS_READ"), posController.dailyReport);
