/**
 * /metrics (lib/metrics.ts): Prometheus text with request counts by route (ids replaced, so no store
 * id or product id becomes a label), queue backlog, circuit breakers and AI outcomes. Open on a
 * developer's machine; in production only with METRICS_TOKEN, sent as a Bearer token.
 */
process.env.RATE_LIMIT_ENABLED = "false";

import request from "supertest";
import type { Express } from "express";
import { metricsAllowed, routeLabel } from "../../src/lib/metrics";

let app: Express;

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
});

afterAll(async () => {
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  await (await import("../../src/lib/cartRecoveryQueue")).closeCartRecoveryQueue();
  await (await import("../../src/lib/advisorQueue")).closeAdvisorQueue();
  await (await import("../../src/lib/trendsQueue")).closeTrendsQueue();
  await (await import("../../src/lib/productScoutQueue")).closeProductScoutQueue();
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("../../src/lib/prisma")).prismaUnscoped.$disconnect();
});

describe("route labels", () => {
  it.each([
    ["/api/v1/stores/cmw51a0nd0002tki88u5cibgk/products/6af70dfeb20e19b6d1022cef?q=x", "/api/v1/stores/:id/products/:id"],
    ["/api/v1/stores/cmw51a0nd0002tki88u5cibgk/checkout/sessions/cs_test_a1B2c3", "/api/v1/stores/:id/checkout/sessions/:id"],
    ["/uploads/products/cmw51a0nd0002tki88u5cibgk/3f90668e-8be1-4c0a-968b-6ebde6efd9b4.png", "/uploads/products/:id/:file"],
    ["/api/v1/plans", "/api/v1/plans"],
  ])("%s becomes %s", (url, label) => {
    expect(routeLabel(url)).toBe(label);
  });
});

describe("who may read /metrics", () => {
  it("anyone on a developer's machine without a token", () => expect(metricsAllowed(undefined, false, "")).toBe(true));
  it("nobody in production without a token", () => expect(metricsAllowed("Bearer anything", true, "")).toBe(false));
  it("in production, only the right token", () => {
    expect(metricsAllowed("Bearer right-token-value", true, "right-token-value")).toBe(true);
    expect(metricsAllowed("Bearer wrong-token-value", true, "right-token-value")).toBe(false);
    expect(metricsAllowed(undefined, true, "right-token-value")).toBe(false);
  });
});

it("a scrape shows request counts by route (no ids), queue backlog and AI outcomes", async () => {
  await request(app).get("/api/v1/plans");
  await request(app).get("/api/v1/stores/cmw51a0nd0002tki88u5cibgk/products/6af70dfeb20e19b6d1022cef");
  const res = await request(app).get("/metrics");
  expect(res.status).toBe(200);
  expect(res.headers["content-type"]).toMatch(/text\/plain/);
  expect(res.text).toMatch(/zyro_http_requests_total\{method="GET",route="\/api\/v1\/plans",status="200"\} \d+/);
  expect(res.text).toContain("zyro_http_request_duration_seconds_bucket");
  expect(res.text).toMatch(/zyro_queue_jobs\{queue="ai",state="waiting"\} \d+/);
  expect(res.text).toContain("# HELP zyro_ai_requests_total");
  expect(res.text).toContain("process_resident_memory_bytes");
  expect(res.text).not.toContain("cmw51a0nd0002tki88u5cibgk");
  expect(res.text).not.toContain("6af70dfeb20e19b6d1022cef");
});
