import { RequestHandler, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { requireOwner } from "../../middleware/requireOwner.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { Errors } from "../../errors/AppError";
import { themeService } from "./theme.service";

/**
 * Store Themes (2026-11), mounted at /stores/:storeId/theme. Every route is the owner's alone: the
 * draft is unpublished work, and only the owner can publish or restore. Shoppers get the published
 * theme with the public store profile (GET /stores/:storeId), never from here.
 */
export const themeRouter = Router({ mergeParams: true });
themeRouter.use(requireAuth, withTenantContext, requireOwner);

const handle =
  (fn: (req: Parameters<RequestHandler>[0]) => Promise<unknown> | unknown): RequestHandler =>
  async (req, res, next) => {
    try {
      res.status(200).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

const draftBody = z.object({ theme: z.unknown() }).strict();
const versionId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

themeRouter.get("/", handle((req) => themeService.get(req.params.storeId)));
themeRouter.get("/options", handle(() => themeService.options()));
themeRouter.put(
  "/draft",
  handle((req) => {
    const body = draftBody.safeParse(req.body);
    if (!body.success) throw Errors.validation("Send the theme as { theme: {...} }");
    return themeService.saveDraft(req.params.storeId, body.data.theme);
  })
);
themeRouter.post("/undo", handle((req) => themeService.undo(req.params.storeId)));
themeRouter.post("/redo", handle((req) => themeService.redo(req.params.storeId)));
themeRouter.post("/publish", handle((req) => themeService.publish(req.params.storeId, req.userId)));
themeRouter.get("/versions", handle((req) => themeService.versions(req.params.storeId)));
themeRouter.post(
  "/versions/:versionId/restore",
  handle((req) => {
    const id = versionId.safeParse(req.params.versionId);
    if (!id.success) throw Errors.notFound("Theme version");
    return themeService.restore(req.params.storeId, id.data);
  })
);
