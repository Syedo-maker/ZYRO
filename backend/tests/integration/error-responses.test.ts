/**
 * B2 (2026-11): what the API answers when a route does not exist or something breaks. An unknown route is
 * a JSON 404 problem; an unexpected error is a 500 that says only that something went wrong and gives a
 * request id to quote, while the error itself (message, stack) goes to the server log.
 */
process.env.RATE_LIMIT_ENABLED = "false";

import request from "supertest";
import type { Express } from "express";

let app: Express;

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
});

afterAll(async () => {
  jest.restoreAllMocks();
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("../../src/lib/prisma")).prismaUnscoped.$disconnect();
});

describe("an unknown API route", () => {
  it("is a JSON 404 problem, for any method", async () => {
    for (const method of ["get", "post", "delete"] as const) {
      const res = await request(app)[method]("/api/v1/no-such-route");
      expect(res.status).toBe(404);
      expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
      expect(res.body).toMatchObject({ status: 404, title: "Route not found" });
    }
  });
});

describe("an unexpected error", () => {
  it("is a 500 with a request id and no internals; the details go to the log", async () => {
    const { productService } = await import("../../src/modules/products/product.service");
    jest.spyOn(productService, "list").mockRejectedValueOnce(new Error("connect to postgres://admin:s3cr3t-pass@db.internal:5432 failed at /srv/app/src/lib/prisma.ts:12"));
    const res = await request(app).get("/api/v1/stores/any-store-id/products");
    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(res.body).toEqual({ type: "https://zyro.dev/errors/internal", title: "Internal server error", status: 500, requestId: expect.any(String) });
    const text = JSON.stringify(res.body);
    for (const leak of ["s3cr3t", "postgres://", "db.internal", "prisma.ts", "/srv/app", "stack", "Error:"]) expect(text).not.toContain(leak);
  });
});
