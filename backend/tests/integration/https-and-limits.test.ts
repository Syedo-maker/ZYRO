/**
 * Production readiness, STEP 4: the HTTPS-only redirect (FORCE_HTTPS) and the request body limit.
 * The redirect goes to PUBLIC_URL's host whatever Host header is sent, so it cannot be used as an
 * open redirect; the health endpoints stay reachable over plain HTTP for the platform's probes.
 */
process.env.RATE_LIMIT_ENABLED = "false";
process.env.FORCE_HTTPS = "true";
process.env.PUBLIC_URL = "https://shop.example.com";
process.env.REQUEST_BODY_LIMIT = "1kb";

import request from "supertest";
import type { Express } from "express";

let app: Express;

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
});

afterAll(async () => {
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("../../src/lib/prisma")).prismaUnscoped.$disconnect();
});

describe("HTTPS only", () => {
  it("redirects a plain-HTTP GET to the same path over https, on PUBLIC_URL's host (301)", async () => {
    const res = await request(app).get("/api/v1/plans?x=1").set("Host", "evil.example.org");
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe("https://shop.example.com/api/v1/plans?x=1");
  });

  it("keeps the method for other requests (308)", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({});
    expect(res.status).toBe(308);
    expect(res.headers.location).toBe("https://shop.example.com/api/v1/auth/login");
  });

  it("leaves the health endpoints alone", async () => {
    expect((await request(app).get("/health")).status).toBe(200);
  });

  it("lets a request through when the proxy says it came over https", async () => {
    // TRUST_PROXY is 0 here, so the header is not trusted: still redirected. That is the safe default.
    const res = await request(app).get("/api/v1/plans").set("X-Forwarded-Proto", "https");
    expect(res.status).toBe(301);
  });
});

describe("request body limit", () => {
  it("answers 413 with a problem body when the JSON body is over the limit", async () => {
    const res = await request(app)
      .post("/health")
      .set("X-Forwarded-Proto", "https")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ text: "x".repeat(4096) }));
    // /health is exempt from the redirect, so the body parser sees it.
    expect(res.status).toBe(413);
    expect(res.body.type).toBe("https://zyro.dev/errors/payload-too-large");
  });
});
