import type { RequestHandler } from "express";
import { timingSafeEqual } from "node:crypto";
import client from "prom-client";

/**
 * Metrics in the Prometheus text format (production readiness, 2026-11), served at /metrics by the
 * API and the worker. Any Prometheus-compatible collector (Prometheus, Grafana Agent, Azure Monitor's
 * managed Prometheus, Datadog) can scrape it. What is measured:
 *
 *   zyro_http_requests_total / zyro_http_request_duration_seconds   by method, route and status
 *   zyro_queue_jobs                                                  waiting, active, delayed, failed per queue
 *   zyro_external_calls_total                                        AI, Stripe, email, storage, recommendations: ok, failed, open
 *   zyro_circuit_open                                                1 while a service's circuit breaker is open
 *   zyro_ai_requests_total                                           answered, unavailable, quota, daily limit, disabled
 *   process_* and nodejs_*                                           CPU, memory, event-loop lag, garbage collection
 *
 * Labels never carry an id, an email or any other personal data: routes are recorded with ids
 * replaced by ":id", so the number of series stays small.
 *
 * /metrics is not under /api, so the web container's nginx never exposes it. In production it is
 * served only when METRICS_TOKEN is set, and only to a scraper sending it as a Bearer token.
 */

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: "" });

const httpRequests = new client.Counter({
  name: "zyro_http_requests_total",
  help: "HTTP requests answered, by method, route (ids replaced) and status code.",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

const httpDuration = new client.Histogram({
  name: "zyro_http_request_duration_seconds",
  help: "Time to answer an HTTP request, by method, route and status class.",
  labelNames: ["method", "route", "status_class"] as const,
  buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 90],
  registers: [registry],
});

export const externalCalls = new client.Counter({
  name: "zyro_external_calls_total",
  help: "Calls to outside services through their circuit breaker: ok, failed, or refused while open.",
  labelNames: ["service", "outcome"] as const,
  registers: [registry],
});

export const aiRequests = new client.Counter({
  name: "zyro_ai_requests_total",
  help: "AI requests by outcome: answered, unavailable, quota_exhausted, daily_limit, disabled.",
  labelNames: ["outcome", "prompt_type"] as const,
  registers: [registry],
});

/** Gauges read when scraped (queue counts, breaker states), registered by the modules that own them. */
export function onScrape(name: string, help: string, labelNames: string[], collect: (set: (labels: Record<string, string>, value: number) => void) => Promise<void> | void) {
  new client.Gauge({
    name,
    help,
    labelNames,
    registers: [registry],
    async collect() {
      this.reset();
      try {
        await collect((labels, value) => this.set(labels, value));
      } catch {
        // A dependency that cannot be read leaves the gauge empty for this scrape rather than failing it.
      }
    },
  });
}

/** An address with its ids replaced, so one route is one series whatever store or product it was. */
export function routeLabel(url: string): string {
  const path = url.split("?")[0];
  return (
    path
      .replace(/\/c[a-z0-9]{20,40}(?=\/|$)/g, "/:id") // store, order and user ids (cuid)
      .replace(/\/[0-9a-f]{24}(?=\/|$)/g, "/:id") // MongoDB ids (products, reviews)
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, "/:id")
      .replace(/\/(cs|pi|evt|sub|cus)_[A-Za-z0-9_]+(?=\/|$)/g, "/:id") // Stripe ids
      .replace(/\/[^/]*\.(png|jpe?g|webp|webm|ogg|mp3|m4a|wav)$/i, "/:file")
      .replace(/\/\d+(?=\/|$)/g, "/:n") || "/"
  );
}

/** Counts and times every request (registered first in app.ts). Health probes are left out. */
export const recordHttpMetrics: RequestHandler = (req, res, next) => {
  if (req.path === "/health" || req.path === "/ready" || req.path === "/metrics") return next();
  const end = httpDuration.startTimer();
  res.on("finish", () => {
    const route = res.statusCode === 404 ? "unmatched" : routeLabel(req.originalUrl);
    const status = String(res.statusCode);
    httpRequests.inc({ method: req.method, route, status });
    end({ method: req.method, route, status_class: `${status[0]}xx` });
  });
  next();
};

/** Whether a /metrics request may be answered (see the note at the top). */
export function metricsAllowed(authorization: string | undefined, isProduction: boolean, token = process.env.METRICS_TOKEN?.trim()): boolean {
  if (!token) return !isProduction;
  const sent = /^Bearer (.+)$/.exec(authorization ?? "")?.[1] ?? "";
  const a = Buffer.from(sent);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function metricsText(): Promise<{ contentType: string; body: string }> {
  return { contentType: registry.contentType, body: await registry.metrics() };
}
