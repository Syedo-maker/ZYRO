import { Router } from "express";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { resolveCartOwner } from "../../middleware/cartOwner.middleware";
import { discountAttemptLimiter } from "../../middleware/rateLimit.middleware";
import { checkoutController } from "./checkout.controller";

// Mounted at /stores/:storeId/checkout; see app.ts. Open to guests and logged-in shoppers.
export const checkoutRouter = Router({ mergeParams: true });

// discountAttemptLimiter only counts requests that carry a code and fail; normal checkouts are untouched.
checkoutRouter.post("/quote", withTenantContext, resolveCartOwner, discountAttemptLimiter, checkoutController.quote);
checkoutRouter.post("/session", withTenantContext, resolveCartOwner, discountAttemptLimiter, checkoutController.createSession);
// Public: the Stripe session id in the confirmation URL is the credential, so no cart owner is needed.
checkoutRouter.get("/sessions/:sessionId", withTenantContext, checkoutController.sessionStatus);
