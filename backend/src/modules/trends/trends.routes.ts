import { RequestHandler, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { Errors } from "../../errors/AppError";
import { STORE_CURRENCY_CODES } from "../../lib/currencies";
import { trendsService } from "./trends.service";

const run =
  (fn: (req: Parameters<RequestHandler>[0]) => Promise<unknown>, status = 200): RequestHandler =>
  async (req, res, next) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

// Mounted at /stores/:storeId/trends (see app.ts). The same permission as the dashboard figures.
export const storeTrendsRouter = Router({ mergeParams: true });
storeTrendsRouter.get("/", requireAuth, withTenantContext, requirePermission("ANALYTICS_READ"), run((req) => trendsService.forStore(req.params.storeId)));

// Mounted under /platform/trends, behind the platform router's super-administrator check (platform.routes.ts).
export const platformTrendsRouter = Router();

const importSchema = z.object({
  /** The file's text. Google Trends files are a few kilobytes; the cap keeps a wrong file from being stored. */
  csv: z.string().min(1).max(90_000),
  market: z.enum(STORE_CURRENCY_CODES),
  category: z.string().trim().min(1).max(80),
  fileName: z.string().trim().max(200).optional(),
});

platformTrendsRouter.get("/", run(() => trendsService.listReports()));
platformTrendsRouter.get("/imports", run(() => trendsService.listImports()));
platformTrendsRouter.post(
  "/imports",
  run(async (req) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) throw Errors.validation(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    return trendsService.importGoogleTrends(parsed.data, req.userId!);
  }, 201)
);
// "Run now": this week's reports straight away instead of waiting for Monday. Still one per category per week.
platformTrendsRouter.post("/run", run(() => trendsService.runWeek()));
