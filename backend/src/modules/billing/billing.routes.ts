import { RequestHandler, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { requireOwner } from "../../middleware/requireOwner.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { Errors } from "../../errors/AppError";
import { billingService } from "./billing.service";

// Mounted at /stores/:storeId/billing (see app.ts). Only the store's owner sees or spends money:
// staff never can, whatever permissions they hold.
export const billingRouter = Router({ mergeParams: true });
// The public price list, mounted at /plans.
export const plansRouter = Router();

const owner = [requireAuth, requireOwner, withTenantContext];

const run =
  (fn: (req: Parameters<RequestHandler>[0]) => Promise<unknown>, status = 200): RequestHandler =>
  async (req, res, next) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

const subscribeSchema = z.object({ plan: z.string() });
const topUpSchema = z.object({ pack: z.string() });

function body<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw Errors.validation(parsed.error.issues.map((i) => i.message).join("; "));
  return parsed.data;
}

billingRouter.get("/", ...owner, run((req) => billingService.overview(req.params.storeId)));
billingRouter.post("/subscribe", ...owner, run((req) => billingService.startSubscription(req.params.storeId, req.userId!, body(subscribeSchema, req.body).plan)));
billingRouter.post("/top-up", ...owner, run((req) => billingService.startTopUp(req.params.storeId, req.userId!, body(topUpSchema, req.body).pack)));
billingRouter.post("/portal", ...owner, run((req) => billingService.openPortal(req.params.storeId)));

plansRouter.get("/", run(async () => billingService.catalog()));
