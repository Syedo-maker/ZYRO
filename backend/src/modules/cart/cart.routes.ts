import { Router } from "express";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { resolveCartOwner } from "../../middleware/cartOwner.middleware";
import { cartController } from "./cart.controller";

// Mounted at /stores/:storeId/cart; see app.ts. Open to guests and logged-in shoppers alike.
export const cartRouter = Router({ mergeParams: true });

cartRouter.use(withTenantContext, resolveCartOwner);

cartRouter.get("/", cartController.get);
cartRouter.post("/merge", cartController.merge);
cartRouter.post("/items", cartController.addItem);
cartRouter.patch("/items/:itemId", cartController.updateItem);
cartRouter.delete("/items/:itemId", cartController.removeItem);
