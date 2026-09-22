import express, { ErrorRequestHandler } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { env } from "./config/env";
import { apiLimiter } from "./middleware/rateLimit.middleware";
import { AppError } from "./errors/AppError";
import { authRouter } from "./modules/auth/auth.routes";
import { staffRouter } from "./modules/stores/staff.routes";
import { storeRouter } from "./modules/stores/store.routes";
import { productRouter } from "./modules/products/product.routes";
import { uploadsRouter } from "./modules/uploads/uploads.routes";
import { meRouter } from "./modules/users/me.routes";
import { cartRouter } from "./modules/cart/cart.routes";
import { checkoutRouter } from "./modules/checkout/checkout.routes";
import { orderRouter } from "./modules/orders/order.routes";
import { shippingRouter } from "./modules/shipping/shipping.routes";
import { posRouter } from "./modules/pos/pos.routes";
import { discountRouter } from "./modules/discounts/discount.routes";
import { analyticsRouter } from "./modules/analytics/analytics.routes";
import { merchantReviewsRouter } from "./modules/reviews/review.routes";
import { aiRouter } from "./modules/ai/ai.routes";
import { stripeWebhookController } from "./modules/webhooks/webhook.controller";

export const app = express();

// Behind a reverse proxy, req.ip would be the proxy's; this makes rate limits see each visitor.
if (env.trustProxy > 0) app.set("trust proxy", env.trustProxy);

// Standard security headers (also removes X-Powered-By). Uploaded images are loaded by the
// storefront from another origin in production, so allow cross-origin embedding.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

app.use(cors({ origin: env.corsOrigin, credentials: true }));

// Registered before express.json(): Stripe signs the exact bytes it sends, so this route
// needs the raw body. Server-to-server, so CORS does not apply to it.
app.post("/api/v1/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhookController);

app.use(express.json());
app.use(cookieParser());

// Served images from uploads_image_create: binary lives on disk, only the URL is
// ever persisted to a database (Implementation_Plan.md Phase 1).
app.use("/uploads", express.static(env.uploadsDir));

app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

const v1 = express.Router();
v1.use(apiLimiter);
v1.use("/auth", authRouter);
v1.use("/users/me", meRouter);
v1.use("/stores/:storeId/staff", staffRouter);
v1.use("/stores/:storeId/products", productRouter);
v1.use("/stores/:storeId/uploads", uploadsRouter);
v1.use("/stores/:storeId/cart", cartRouter);
v1.use("/stores/:storeId/checkout", checkoutRouter);
v1.use("/stores/:storeId/orders", orderRouter);
v1.use("/stores/:storeId/shipping-zones", shippingRouter);
v1.use("/stores/:storeId/pos", posRouter);
v1.use("/stores/:storeId/discount-codes", discountRouter);
v1.use("/stores/:storeId/analytics", analyticsRouter);
v1.use("/stores/:storeId/reviews", merchantReviewsRouter);
v1.use("/stores/:storeId/ai-usage", aiRouter);
v1.use("/stores/:storeId", storeRouter);
app.use("/api/v1", v1);

app.use((req, res) => {
  res.status(404).type("application/problem+json").json({
    type: "https://zyro.dev/errors/not-found",
    title: "Route not found",
    status: 404,
    detail: `No route for ${req.method} ${req.path}`,
  });
});

// Must be declared with 4 params for Express to treat it as an error handler.
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).type("application/problem+json").json(err.toProblem());
    return;
  }

  // Client mistakes raised by Express itself (malformed JSON, body too large) are the
  // caller's error, not a server fault, so answer 4xx instead of 500.
  const status = (err as { status?: number }).status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    const tooLarge = status === 413;
    res.status(status).type("application/problem+json").json({
      type: tooLarge ? "https://zyro.dev/errors/payload-too-large" : "https://zyro.dev/errors/validation-failed",
      title: tooLarge ? "Request body is too large" : "Request could not be read",
      status,
      detail: tooLarge ? undefined : "The request body is not valid JSON",
    });
    return;
  }

  console.error(err);
  res.status(500).type("application/problem+json").json({
    type: "https://zyro.dev/errors/internal",
    title: "Internal server error",
    status: 500,
  });
};
app.use(errorHandler);
