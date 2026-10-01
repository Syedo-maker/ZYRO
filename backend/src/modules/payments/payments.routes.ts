import { RequestHandler, Router } from "express";
import multer from "multer";
import { env } from "../../config/env";
import { imageUpload } from "../../middleware/upload.middleware";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { requireOwner } from "../../middleware/requireOwner.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { resolveCartOwner } from "../../middleware/cartOwner.middleware";
import { Errors } from "../../errors/AppError";
import { listGateways } from "./gateways";
import { paymentsService } from "./payments.service";
import { localCheckoutService } from "./checkout.local.service";
import { proofService } from "./proof.service";
import { codService } from "./cod.service";
import { helpService } from "./help.service";
import {
  codOutcomeSchema,
  importRemittanceSchema,
  paymentHelpSchema,
  placeLocalOrderSchema,
  reviewProofSchema,
  submitProofSchema,
  updatePaymentSettingsSchema,
} from "./payments.validation";

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

/** Turns a rejected file type or an over-size upload into our normal 400, as uploads.routes.ts does. */
const handleImageUpload: RequestHandler = (req, res, next) => {
  imageUpload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) return next(Errors.validation(err.message));
    if (err) return next(Errors.validation((err as Error).message));
    next();
  });
};

const parse = <T>(schema: { safeParse(v: unknown): { success: boolean; data?: T; error?: { issues: { path: (string | number)[]; message: string }[] } } }, body: unknown): T => {
  const result = schema.safeParse(body);
  if (!result.success || !result.data) {
    throw Errors.validation(result.error!.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; "));
  }
  return result.data;
};

/**
 * Part E's endpoints, mounted at /stores/:storeId/payments (see app.ts).
 *
 * Who may do what: a shopper places an order and sends in a receipt (no login needed, a guest
 * session is enough, like the rest of checkout); staff with `orders_write` run the COD queue and
 * check receipts; only the owner changes which payment methods the store offers.
 */
export const paymentsRouter = Router({ mergeParams: true });

// ---- The shopper ----

/** Which ways this cart may be paid for, and for cash on delivery whether this order may use it. */
paymentsRouter.post(
  "/options",
  withTenantContext,
  resolveCartOwner,
  run((req) => localCheckoutService.options(req.params.storeId, req.cartOwner!, parse(placeLocalOrderSchema, req.body)))
);

/** Places a cash-on-delivery or bank-transfer order. */
paymentsRouter.post(
  "/orders",
  withTenantContext,
  resolveCartOwner,
  run((req) => localCheckoutService.place(req.params.storeId, req.cartOwner!, parse(placeLocalOrderSchema, req.body)), 201)
);

/**
 * Uploads the screenshot itself. A shopper is not logged in, so this is not behind a merchant
 * permission; what guards it instead is the order: the file is only accepted for an order that
 * exists in this store, was placed as a bank transfer, and has not been paid for yet. The same
 * 5 MB image-only limits as every other upload apply.
 */
paymentsRouter.post(
  "/orders/:orderId/proof-image",
  withTenantContext,
  handleImageUpload,
  run(async (req) => {
    if (!req.file) throw Errors.validation("No image was uploaded, or it failed the type or size check");
    await proofService.assertCanUpload(req.params.storeId, req.params.orderId);
    return { url: `${env.publicUrl}/uploads/${req.file.filename}` };
  }, 201)
);

/** Sends in the screenshot of a transfer the shopper made. */
paymentsRouter.post(
  "/orders/:orderId/proof",
  withTenantContext,
  run((req) => proofService.submit(req.params.storeId, req.params.orderId, parse(submitProofSchema, req.body)), 201)
);

/** Whether that screenshot has been checked yet. Never shows the findings. */
paymentsRouter.get(
  "/orders/:orderId/proof",
  withTenantContext,
  run((req) => proofService.forShopper(req.params.storeId, req.params.orderId))
);

/** A plain explanation of a failed payment, in English, Urdu or Roman Urdu. */
paymentsRouter.post(
  "/help",
  withTenantContext,
  run((req) => helpService.explain(req.params.storeId, parse(paymentHelpSchema, req.body)))
);

// ---- The merchant ----

const manage = [requireAuth, withTenantContext, requirePermission("ORDERS_WRITE")];

paymentsRouter.get("/cod/pending", ...manage, run((req) => codService.pending(req.params.storeId)));

paymentsRouter.post(
  "/cod/orders/:orderId/outcome",
  ...manage,
  run((req) => codService.recordOutcome(req.params.storeId, req.params.orderId, parse(codOutcomeSchema, req.body)))
);

paymentsRouter.get("/proofs", ...manage, run((req) => proofService.list(req.params.storeId, typeof req.query.status === "string" ? req.query.status : undefined)));

paymentsRouter.post(
  "/proofs/:proofId/review",
  ...manage,
  run((req) => proofService.review(req.params.storeId, req.params.proofId, req.userId!, parse(reviewProofSchema, req.body)))
);

paymentsRouter.get("/remittances", ...manage, run((req) => codService.listRuns(req.params.storeId)));
paymentsRouter.get("/remittances/:runId", ...manage, run((req) => codService.getRun(req.params.storeId, req.params.runId)));
paymentsRouter.post(
  "/remittances",
  ...manage,
  run((req) => codService.importRemittance(req.params.storeId, req.userId!, parse(importRemittanceSchema, req.body)), 201)
);

// ---- The owner ----

paymentsRouter.get(
  "/settings",
  requireAuth,
  requireOwner,
  withTenantContext,
  run(async (req) => ({ settings: await paymentsService.getSettings(req.params.storeId), gateways: listGateways() }))
);

paymentsRouter.patch(
  "/settings",
  requireAuth,
  requireOwner,
  withTenantContext,
  run((req) => {
    const input = parse(updatePaymentSettingsSchema, req.body);
    // Decimal columns take strings; undefined leaves a field alone, null clears it.
    const amount = (v: number | null | undefined) => (v === undefined ? undefined : v === null ? null : v.toFixed(2));
    return paymentsService.updateSettings(req.params.storeId, {
      ...input,
      codMinAmount: amount(input.codMinAmount),
      codMaxAmount: amount(input.codMaxAmount),
    });
  })
);
