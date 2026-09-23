import { Request, RequestHandler, Router } from "express";
import type { ZodType } from "zod";
import { accessToken } from "../../lib/jwt";
import { Errors } from "../../errors/AppError";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { reviewWriteLimiter } from "../../middleware/rateLimit.middleware";
import { reviewService } from "./review.service";
import { aiContentService } from "../ai-content/ai-content.service";
import {
  createReviewSchema,
  listReviewsQuerySchema,
  merchantListQuerySchema,
  moderateReviewSchema,
  updateReviewSchema,
} from "./review.validation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parse<T>(schema: ZodType<T, any, any>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw Errors.validation(result.error.issues.map((i) => i.message).join("; "));
  return result.data;
}

const route =
  (fn: (req: Request, res: import("express").Response) => Promise<void>): RequestHandler =>
  async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

/** The signed-in shopper, if there is a valid token. Browsing reviews stays public; a bad or missing token just means "not signed in". */
function viewerId(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return undefined;
  try {
    return accessToken.verify(auth.slice("Bearer ".length)).sub;
  } catch {
    return undefined;
  }
}

const storeId = (req: Request) => req.params.storeId;

/** Mounted at /stores/:storeId/products/:productId/reviews (see product.routes.ts). */
export const productReviewsRouter = Router({ mergeParams: true });

// Public: anyone can read the published reviews and the rating summary.
productReviewsRouter.get(
  "/",
  withTenantContext,
  route(async (req, res) => {
    res.status(200).json(await reviewService.list(storeId(req), req.params.productId, parse(listReviewsQuerySchema, req.query), viewerId(req)));
  })
);

// A signed-in shopper: one review per product, written, edited and deleted by its author.
productReviewsRouter.post(
  "/",
  requireAuth,
  withTenantContext,
  reviewWriteLimiter,
  route(async (req, res) => {
    res.status(201).json(await reviewService.create(storeId(req), req.params.productId, req.userId!, parse(createReviewSchema, req.body)));
  })
);
productReviewsRouter.put(
  "/mine",
  requireAuth,
  withTenantContext,
  reviewWriteLimiter,
  route(async (req, res) => {
    res.status(200).json(await reviewService.updateMine(storeId(req), req.params.productId, req.userId!, parse(updateReviewSchema, req.body)));
  })
);
productReviewsRouter.delete(
  "/mine",
  requireAuth,
  withTenantContext,
  reviewWriteLimiter,
  route(async (req, res) => {
    await reviewService.removeMine(storeId(req), req.params.productId, req.userId!);
    res.status(204).send();
  })
);

// AI review summarization (Phase 4, Module 6): a merchant-facing insight, not shopper content,
// so it lives here (this product's reviews) rather than in the merchant moderation router.
const summarizeManage = [requireAuth, withTenantContext, requirePermission("PRODUCTS_WRITE")];
productReviewsRouter.get(
  "/summary",
  ...summarizeManage,
  route(async (req, res) => {
    res.status(200).json(await aiContentService.getReviewSummary(storeId(req), req.params.productId));
  })
);
productReviewsRouter.post(
  "/summarize",
  ...summarizeManage,
  route(async (req, res) => {
    res.status(202).json(await aiContentService.summarizeReviews(storeId(req), req.params.productId));
  })
);

/** Mounted at /stores/:storeId/reviews: the merchant's moderation list. Owner, or staff with products_write. */
export const merchantReviewsRouter = Router({ mergeParams: true });
const moderate = [requireAuth, withTenantContext, requirePermission("PRODUCTS_WRITE")];

merchantReviewsRouter.get(
  "/",
  ...moderate,
  route(async (req, res) => {
    res.status(200).json(await reviewService.merchantList(storeId(req), parse(merchantListQuerySchema, req.query)));
  })
);
merchantReviewsRouter.patch(
  "/:reviewId",
  ...moderate,
  route(async (req, res) => {
    res.status(200).json(await reviewService.moderate(storeId(req), req.params.reviewId, parse(moderateReviewSchema, req.body)));
  })
);
