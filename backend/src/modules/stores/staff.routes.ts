import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requireOwner } from "../../middleware/requireOwner.middleware";
import { staffController } from "./staff.controller";

// Mounted at /stores/:storeId/staff; see app.ts. Owner-only: staff cannot manage staff.
export const staffRouter = Router({ mergeParams: true });

staffRouter.get("/", requireAuth, withTenantContext, requireOwner, staffController.list);
staffRouter.post("/", requireAuth, withTenantContext, requireOwner, staffController.create);
staffRouter.delete("/:staffId", requireAuth, withTenantContext, requireOwner, staffController.remove);
