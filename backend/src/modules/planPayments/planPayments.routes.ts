import { Router, type RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import { env } from "../../config/env";
import { imageUpload, storeImage } from "../../middleware/upload.middleware";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { requireOwner } from "../../middleware/requireOwner.middleware";
import { requireSuperAdmin } from "../../middleware/requireSuperAdmin.middleware";
import { planPaymentStoreLimiter, planPaymentUserLimiter } from "../../middleware/rateLimit.middleware";
import { getStorage } from "../../lib/storage";
import { Errors } from "../../errors/AppError";
import { planPaymentsService } from "./planPayments.service";

/**
 * Plan payments by transfer (Pro plan payments, 2026-11).
 *   /stores/:storeId/plan-payments   the store's owner only: the upgrade page, the proof, the transaction ID
 *   /platform/plan-requests          platform admins: the queue, the review page, decisions
 * Every check is on the server: the owner check, the approver list, the request's store, its status.
 */

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

const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const result = schema.safeParse(body);
  if (!result.success) throw Errors.validation(result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return result.data;
};

const handleImageUpload: RequestHandler = (req, res, next) => {
  imageUpload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) return next(Errors.validation(err.message));
    if (err) return next(Errors.validation((err as Error).message));
    next();
  });
};

const currencySchema = z.object({ currency: z.string().trim().regex(/^[A-Za-z]{3}$/) }).strict();
const submitSchema = z.object({ imageKey: z.string().min(1).max(200), transactionId: z.string().trim().min(1).max(100) }).strict();
const money = z.number().finite().positive().max(1e9);
const approveSchema = z
  .object({ token: z.string().min(20).max(200).optional(), receivedAmount: money.optional(), receivedCurrency: z.string().trim().regex(/^[A-Za-z]{3}$/).optional(), receivedPkr: money.optional() })
  .strict();
const rejectSchema = z.object({ reason: z.string().trim().min(3).max(300), token: z.string().min(20).max(200).optional() }).strict();
const revokeSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
const ownerCurrencySchema = z.object({ currency: z.string().trim().regex(/^[A-Za-z]{3}$/), reason: z.string().trim().min(3).max(300) }).strict();

export const planPaymentsRouter = Router({ mergeParams: true });
planPaymentsRouter.use(requireAuth, requireOwner);

planPaymentsRouter.get("/", run((req) => planPaymentsService.overview(req.params.storeId, req.userId!)));
planPaymentsRouter.put("/currency", run((req) => planPaymentsService.chooseCurrency(req.params.storeId, req.userId!, parse(currencySchema, req.body).currency)));
planPaymentsRouter.post("/requests", run((req) => planPaymentsService.startRequest(req.params.storeId, req.userId!), 201));
// Only an open request of this store accepts a file, checked before the upload is read.
const openRequestOnly: RequestHandler = async (req, _res, next) => {
  try {
    await planPaymentsService.assertCanUpload(req.params.storeId, req.params.requestId);
    next();
  } catch (err) {
    next(err);
  }
};
planPaymentsRouter.post(
  "/requests/:requestId/proof-image",
  planPaymentStoreLimiter,
  planPaymentUserLimiter,
  openRequestOnly,
  handleImageUpload,
  run(async (req) => {
    if (!req.file) throw Errors.validation("No image was uploaded, or it failed the type or size check");
    // Private: a receipt carries names and account numbers. The owner gets the key to submit and a
    // short-lived link so the page can show what they picked.
    const key = await storeImage(req.file.buffer, "plans", req.params.storeId);
    return { key, url: await getStorage().signedUrl(key, env.storage.privateLinkSeconds) };
  }, 201),
);
planPaymentsRouter.post(
  "/requests/:requestId/submit",
  planPaymentStoreLimiter,
  planPaymentUserLimiter,
  run((req) => planPaymentsService.submit(req.params.storeId, req.userId!, req.params.requestId, parse(submitSchema, req.body))),
);

export const planPaymentsAdminRouter = Router();
planPaymentsAdminRouter.use(requireAuth, requireSuperAdmin);

planPaymentsAdminRouter.get("/", run((req) => planPaymentsService.list(typeof req.query.status === "string" ? req.query.status : undefined)));
planPaymentsAdminRouter.get(
  "/review/:token",
  run(async (req) => planPaymentsService.resolveReviewLink(req.params.token, await planPaymentsService.assertApprover(req.userId!))),
);
planPaymentsAdminRouter.get("/:id", run((req) => planPaymentsService.get(req.params.id)));
planPaymentsAdminRouter.post("/:id/approve", run((req) => planPaymentsService.approve(req.params.id, req.userId!, parse(approveSchema, req.body ?? {}))));
planPaymentsAdminRouter.post("/:id/reject", run((req) => planPaymentsService.reject(req.params.id, req.userId!, parse(rejectSchema, req.body))));
planPaymentsAdminRouter.post("/:id/revoke", run((req) => planPaymentsService.revoke(req.params.id, req.userId!, parse(revokeSchema, req.body))));
planPaymentsAdminRouter.put("/owners/:userId/billing-currency", run((req) => planPaymentsService.changeOwnerCurrency(req.params.userId, req.userId!, parse(ownerCurrencySchema, req.body))));

