import { Router } from "express";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { resolveCartOwner } from "../../middleware/cartOwner.middleware";
import { chatMessageLimiter } from "../../middleware/rateLimit.middleware";
import { assistantController } from "./assistant.controller";

// Mounted at /stores/:storeId/assistant; see app.ts. Public to any shopper (signed in or a
// guest), the same identity as the cart: buying does not need an account, and neither does
// asking the assistant a question.
export const assistantRouter = Router({ mergeParams: true });

assistantRouter.post("/chat", withTenantContext, resolveCartOwner, chatMessageLimiter, assistantController.chat);
