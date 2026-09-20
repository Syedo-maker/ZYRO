import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { resolveCartOwner } from "../../middleware/cartOwner.middleware";
import { discountAttemptLimiter } from "../../middleware/rateLimit.middleware";
import { discountController } from "./discount.controller";

// Mounted at /stores/:storeId/discount-codes; see app.ts.
export const discountRouter = Router({ mergeParams: true });

// Storefront: open to guests and logged-in shoppers. Registered before the /:codeId route so
// "validate" is never read as a code id. Wrong guesses are rate limited per address.
discountRouter.post("/validate", withTenantContext, resolveCartOwner, discountAttemptLimiter, discountController.validate);

// Merchant: owner, or staff with the discounts_write permission.
const manage = [requireAuth, withTenantContext, requirePermission("DISCOUNTS_WRITE")];
discountRouter.get("/", ...manage, discountController.list);
discountRouter.post("/", ...manage, discountController.create);
discountRouter.patch("/:codeId", ...manage, discountController.update);
