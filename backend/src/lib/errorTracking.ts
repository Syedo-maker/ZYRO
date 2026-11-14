import type * as SentryType from "@sentry/node";
import { logger } from "./logger";

/**
 * Error tracking (production readiness, 2026-11), compatible with Sentry and anything that speaks its
 * protocol (GlitchTip, self-hosted Sentry). Off unless SENTRY_DSN is set; the library is only loaded
 * then. What is sent is the error, its stack, and tags to find it: environment, release, request id,
 * store id, method and path. Never personal data: no cookies, headers, bodies, query strings, IP
 * addresses or user details (dataCollection is all off and beforeSend strips the request to method and path).
 *
 * Application Insights (instrumentation.ts) owns OpenTelemetry, so Sentry is started without its own
 * OpenTelemetry setup and only reports errors.
 */

let sentry: typeof SentryType | null = null;

export interface ErrorContext {
  requestId?: string;
  tenantId?: string;
  method?: string;
  path?: string;
  /** What the process was doing: "request", "worker job", "unhandled rejection"... */
  where?: string;
}

/** Starts error tracking when SENTRY_DSN is set. Returns whether it is on. `extra` is for tests. */
export function initErrorTracking(service: "api" | "worker", extra: Partial<SentryType.NodeOptions> = {}): boolean {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn && !extra.dsn) return false;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sentry = require("@sentry/node") as typeof SentryType;
  Sentry.init({
    dsn,
    environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "development",
    release: process.env.APP_RELEASE || undefined,
    serverName: service,
    // No personal data of any kind: no user details, cookies, headers, bodies, query strings or AI text.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
    },
    tracesSampleRate: 0,
    // Application Insights owns OpenTelemetry (instrumentation.ts); Sentry must not register its own.
    enableOpenTelemetrySetup: false,
    defaultIntegrations: false,
    integrations: [],
    beforeSend(event) {
      // Only the method and the path; never headers, cookies, a body or a query string.
      if (event.request) event.request = { method: event.request.method, url: event.request.url?.split("?")[0] };
      delete event.user;
      return event;
    },
    ...extra,
  });
  sentry = Sentry;
  logger.info({ service }, "error tracking is on (Sentry-compatible)");
  return true;
}

/** Reports an unexpected error. A no-op when error tracking is off. */
export function reportError(err: unknown, context: ErrorContext = {}): void {
  if (!sentry) return;
  const s = sentry;
  s.withScope((scope) => {
    if (context.where) scope.setTag("where", context.where);
    if (context.tenantId) scope.setTag("tenantId", context.tenantId);
    if (context.requestId) scope.setTag("requestId", context.requestId);
    if (context.method || context.path) scope.setContext("request", { method: context.method, path: context.path?.split("?")[0] });
    s.captureException(err);
  });
}

/** Sends anything still queued, before the process exits. */
export async function flushErrorTracking(timeoutMs = 2000): Promise<void> {
  if (sentry) await sentry.flush(timeoutMs).catch(() => undefined);
}

/** Tests only. */
export async function stopErrorTracking(): Promise<void> {
  if (sentry) await sentry.close(1000).catch(() => undefined);
  sentry = null;
}
