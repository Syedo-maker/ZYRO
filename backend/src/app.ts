import { randomUUID } from "node:crypto";
import express, { ErrorRequestHandler } from "express";
import { pinoHttp } from "pino-http";
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
import { assistantRouter } from "./modules/assistant/assistant.routes";
import { cartRecoveryRouter } from "./modules/cart-recovery/cartRecovery.routes";
import { insightsRouter } from "./modules/insights/insights.routes";
import { billingRouter, plansRouter } from "./modules/billing/billing.routes";
import { platformRouter } from "./modules/platform/platform.routes";
import { advisorRouter } from "./modules/advisor/advisor.routes";
import { paymentsRouter } from "./modules/payments/payments.routes";
import { demoRouter } from "./modules/demo/demo.routes";
import { directoryRouter } from "./modules/stores/directory.routes";
import { ideasRouter } from "./modules/ideas/ideas.routes";
import { voiceRouter } from "./modules/voice/voice.routes";
import { bargainRouter } from "./modules/bargain/bargain.routes";
import { storeTrendsRouter } from "./modules/trends/trends.routes";
import { stripeWebhookController } from "./modules/webhooks/webhook.controller";
import { filesRouter } from "./modules/files/files.routes";
import { logger } from "./lib/logger";
import { isDraining, readiness } from "./lib/lifecycle";
import { requestTimeout } from "./middleware/timeout.middleware";

export const app = express();

// Behind a reverse proxy, req.ip would be the proxy's; this makes rate limits see each visitor.
if (env.trustProxy > 0) app.set("trust proxy", env.trustProxy);

// Standard security headers (also removes X-Powered-By). Uploaded images are loaded by the
// storefront from another origin in production, so allow cross-origin embedding.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

app.use(cors({ origin: env.corsOrigin, credentials: true }));

// One structured line per request, with an id that is also sent back as X-Request-Id: a merchant
// who reports a problem can quote it, and it finds the exact line in Log Analytics. An id sent in by
// a trusted caller (the ingress, another service) is kept so one request can be followed across
// services. The path is logged without its query string, which can hold a signed file link.
app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const incoming = req.headers["x-request-id"];
      const id = typeof incoming === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : randomUUID();
      res.setHeader("X-Request-Id", id);
      return id;
    },
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, path: String(req.url).split("?")[0] }),
      res: (res) => ({ status: res.statusCode }),
    },
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : "info"),
    autoLogging: { ignore: (req) => req.url === "/health" || req.url === "/ready" },
  })
);
app.use(requestTimeout);

// Registered before express.json(): Stripe signs the exact bytes it sends, so this route
// needs the raw body. Server-to-server, so CORS does not apply to it.
app.post("/api/v1/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhookController);

app.use(express.json());
app.use(cookieParser());

// Public files (product images) on the local driver. Only the public area is ever served here:
// receipts and voice notes live in a separate folder and go through /api/v1/files with a signed
// link (lib/storage.ts). On Azure, images are served by Blob Storage itself and this stays empty.
// `nosniff` comes from helmet above, and the CSP stops any file being run as a page.
app.use(
  "/uploads",
  express.static(env.uploadsDir, {
    dotfiles: "deny",
    index: false,
    setHeaders: (res) => res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox"),
  })
);

// Liveness and readiness (lib/lifecycle.ts explains why they are two different questions).
app.get("/health", (_req, res) => res.status(200).json({ status: isDraining() ? "draining" : "ok" }));
app.get("/ready", async (_req, res) => {
  const result = await readiness();
  res.status(result.ready ? 200 : 503).json({ status: result.ready ? "ready" : isDraining() ? "draining" : "not ready", checks: result.checks });
});

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
v1.use("/stores/:storeId/assistant", assistantRouter);
v1.use("/stores/:storeId/cart-recovery", cartRecoveryRouter);
v1.use("/stores/:storeId/insights", insightsRouter);
v1.use("/stores/:storeId/billing", billingRouter);
v1.use("/stores/:storeId/advisor", advisorRouter);
v1.use("/stores/:storeId/trends", storeTrendsRouter);
v1.use("/stores/:storeId/payments", paymentsRouter);
v1.use("/stores/:storeId/voice-notes", voiceRouter);
v1.use("/stores/:storeId/product-ideas", ideasRouter);
v1.use("/stores/:storeId/products/:productId/bargain", bargainRouter);
// Public shop directory (Issue 2). Before the /stores/:storeId router, so "/" and "/categories"
// are not read as a store id.
v1.use("/stores", directoryRouter);
v1.use("/stores/:storeId", storeRouter);
// The landing page's trending suggestions demo (public; budget enforced in demo.service.ts).
v1.use("/demo", demoRouter);
v1.use("/plans", plansRouter);
v1.use("/files", filesRouter);
v1.use("/platform", platformRouter);
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
const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // The request already had its answer (it timed out, say, and the handler finished late). Nothing
  // more can be sent; Express's own handler closes the connection.
  if (res.headersSent) {
    req.log.warn({ err: { message: (err as Error).message } }, "error after the response was sent");
    return next(err);
  }
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

  req.log.error({ err }, "unhandled error");
  res.status(500).type("application/problem+json").json({
    type: "https://zyro.dev/errors/internal",
    title: "Internal server error",
    status: 500,
    // Something to quote to support; it finds this exact failure in the logs.
    requestId: req.id,
  });
};
app.use(errorHandler);
