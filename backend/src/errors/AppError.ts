/**
 * Matches the `Error` schema in backend/openapi.yaml (RFC 7807 problem details).
 * Thrown from anywhere in a request handler and caught by the error-handling
 * middleware in app.ts, which serializes it as `application/problem+json`.
 */
export class AppError extends Error {
  readonly status: number;
  readonly type: string;
  readonly detail?: string;

  constructor(status: number, type: string, title: string, detail?: string) {
    super(title);
    this.status = status;
    this.type = type;
    this.detail = detail;
  }

  toProblem() {
    return {
      type: this.type,
      title: this.message,
      status: this.status,
      ...(this.detail ? { detail: this.detail } : {}),
    };
  }
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
  quotaExhausted: (detail: string) =>
    new AppError(402, "https://zyro.dev/errors/ai-quota-exhausted", "Monthly AI usage quota exhausted", detail),
};
