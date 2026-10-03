import { RequestHandler, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { resolveCartOwner } from "../../middleware/cartOwner.middleware";
import { Errors } from "../../errors/AppError";
import { bargainService } from "./bargain.service";

const run =
  (fn: (req: Parameters<RequestHandler>[0]) => Promise<unknown>, status = 200): RequestHandler =>
  async (req, res, next) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

const turnSchema = z.object({ message: z.string().trim().min(1).max(500) });

/**
 * Part G's bargaining, mounted at /stores/:storeId/products/:productId/bargain (see app.ts).
 *
 * Open to shoppers, signed in or guests, like the rest of the storefront. Nothing a shopper sends
 * decides a price: the message is read only for the number they named, and every price in the reply
 * is worked out by the server from the merchant's own floor.
 */
export const bargainRouter = Router({ mergeParams: true });

bargainRouter.get("/", withTenantContext, run((req) => bargainService.offer(req.params.storeId, req.params.productId)));

/**
 * The floor price itself, for the merchant's own product form. Behind `products_write`, because the
 * public product endpoints deliberately never return it: a shopper who knew it would simply ask for it.
 */
bargainRouter.get(
  "/settings",
  requireAuth,
  withTenantContext,
  requirePermission("PRODUCTS_WRITE"),
  run((req) => bargainService.settings(req.params.storeId, req.params.productId))
);

bargainRouter.post("/", withTenantContext, resolveCartOwner, run((req) => bargainService.start(req.params.storeId, req.params.productId, req.cartOwner!), 201));

bargainRouter.post(
  "/:sessionId/turn",
  withTenantContext,
  resolveCartOwner,
  run((req) => {
    const parsed = turnSchema.safeParse(req.body);
    if (!parsed.success) throw Errors.validation("Type a short message");
    return bargainService.turn(req.params.storeId, req.params.sessionId, req.cartOwner!, parsed.data.message);
  })
);
