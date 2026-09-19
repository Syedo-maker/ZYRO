import { Router } from "express";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { resolveCartOwner } from "../../middleware/cartOwner.middleware";
import { checkoutController } from "./checkout.controller";

// Mounted at /stores/:storeId/checkout; see app.ts. Open to guests and logged-in shoppers.
export const checkoutRouter = Router({ mergeParams: true });

checkoutRouter.post("/quote", withTenantContext, resolveCartOwner, checkoutController.quote);
checkoutRouter.post("/session", withTenantContext, resolveCartOwner, checkoutController.createSession);
// Public: the Stripe session id in the confirmation URL is the credential, so no cart owner is needed.
checkoutRouter.get("/sessions/:sessionId", withTenantContext, checkoutController.sessionStatus);
