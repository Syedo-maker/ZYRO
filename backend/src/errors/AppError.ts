/**
 * Matches the `Error` schema in backend/openapi.yaml (RFC 7807 problem details).
 * Thrown from anywhere in a request handler and caught by the error-handling
 * middleware in app.ts, which serializes it as `application/problem+json`.
 */
export class AppError extends Error {
  readonly status: number;
  readonly type: string;
  readonly detail?: string;
  /** Extra members added to the problem body (RFC 7807 allows them), e.g. the `upgrade` hint on a plan limit. */
  readonly extensions?: Record<string, unknown>;

  constructor(status: number, type: string, title: string, detail?: string, extensions?: Record<string, unknown>) {
    super(title);
    this.status = status;
    this.type = type;
    this.detail = detail;
    this.extensions = extensions;
  }

  toProblem() {
    return {
      type: this.type,
      title: this.message,
      status: this.status,
      ...(this.detail ? { detail: this.detail } : {}),
      ...(this.extensions ?? {}),
    };
  }
}

/** What a client needs to show "upgrade to X" instead of a bare error. */
export interface UpgradeHint {
  /** Which limit was hit: "products", "staff", "analytics_range", "custom_domain". */
  feature: string;
  currentPlan: string;
  /** The cheapest plan that allows it; null when even the top plan does not. */
  requiredPlan: string | null;
  /** The current plan's limit, when it is a number. */
  limit?: number;
}

export const Errors = {
  invalidCredentials: () =>
    new AppError(401, "https://zyro.dev/errors/invalid-credentials", "Invalid credentials"),
  emailTaken: () =>
    new AppError(409, "https://zyro.dev/errors/email-taken", "Email is already registered"),
  slugTaken: () =>
    new AppError(409, "https://zyro.dev/errors/slug-taken", "Store slug is already taken"),
  unauthorized: (detail?: string) =>
    new AppError(401, "https://zyro.dev/errors/unauthorized", "Authentication required", detail),
  forbidden: (detail?: string) =>
    new AppError(403, "https://zyro.dev/errors/forbidden", "You don't have permission to do this", detail),
  notFound: (what: string) =>
    new AppError(404, "https://zyro.dev/errors/not-found", `${what} not found`),
  invalidRefreshToken: () =>
    new AppError(401, "https://zyro.dev/errors/invalid-refresh-token", "Refresh token is invalid or expired"),
  tooManyRequests: (retryAfterSeconds: number) =>
    new AppError(
      429,
      "https://zyro.dev/errors/too-many-requests",
      "Too many attempts",
      `Please wait ${Math.max(1, Math.ceil(retryAfterSeconds / 60))} minute(s) and try again.`
    ),
  conflict: (detail: string) =>
    new AppError(409, "https://zyro.dev/errors/conflict", "Conflict with the current state", detail),
  serviceUnavailable: (detail: string) =>
    new AppError(503, "https://zyro.dev/errors/service-unavailable", "Service unavailable", detail),
  insufficientStock: (detail: string) =>
    new AppError(409, "https://zyro.dev/errors/insufficient-stock", "Insufficient stock", detail),
  discountInvalid: (detail: string) =>
    new AppError(400, "https://zyro.dev/errors/invalid-discount-code", "Discount code cannot be used", detail),
  validation: (detail: string) =>
    new AppError(400, "https://zyro.dev/errors/validation-failed", "Request validation failed", detail),
  quotaExhausted: (detail: string, extensions?: Record<string, unknown>) =>
    new AppError(402, "https://zyro.dev/errors/ai-quota-exhausted", "Monthly AI usage quota exhausted", detail, extensions),
  /** 402, with an `upgrade` member so the storefront admin can offer the right plan instead of an error. */
  planLimit: (detail: string, upgrade: UpgradeHint) =>
    new AppError(402, "https://zyro.dev/errors/plan-limit-reached", "Your plan's limit has been reached", detail, { upgrade }),
};
