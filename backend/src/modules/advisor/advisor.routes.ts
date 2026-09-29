import { RequestHandler, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { requireOwner } from "../../middleware/requireOwner.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { Errors } from "../../errors/AppError";
import { advisorService } from "./advisor.service";

// Mounted at /stores/:storeId/advisor (see app.ts). Reading tips needs the same permission as the
// dashboard figures they come from; switching tips off is the owner's choice.
export const advisorRouter = Router({ mergeParams: true });

const reader = [requireAuth, withTenantContext, requirePermission("ANALYTICS_READ")];

const run =
  (fn: (req: Parameters<RequestHandler>[0]) => Promise<unknown>, status = 200): RequestHandler =>
  async (req, res, next) => {
    try {
      const out = await fn(req);
      if (out === undefined) res.status(204).send();
      else res.status(status).json(out);
    } catch (err) {
      next(err);
    }
  };

const settingsSchema = z.object({ enabled: z.boolean() });

advisorRouter.get("/", ...reader, run((req) => advisorService.current(req.params.storeId)));

// "Check now": runs this week's check straight away instead of waiting for Monday. Still at most
// one tip a week: if the week already has one, that tip is returned.
advisorRouter.post("/check", ...reader, run(async (req) => ({ tip: await advisorService.runForTenant(req.params.storeId) })));

advisorRouter.patch(
  "/",
  requireAuth,
  requireOwner,
  withTenantContext,
  run(async (req) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) throw Errors.validation("Send { enabled: true } or { enabled: false }");
    return advisorService.setEnabled(req.params.storeId, parsed.data.enabled);
  })
);

advisorRouter.post("/tips/:tipId/dismiss", ...reader, run(async (req) => advisorService.dismiss(req.params.storeId, req.params.tipId)));
