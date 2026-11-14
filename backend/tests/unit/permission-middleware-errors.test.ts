/**
 * requireOwner and requirePermission look the store up in the database before anything else. When
 * that lookup fails (the database unreachable), the error must go to Express's error handler at
 * once (a 500), not escape as an unhandled rejection that leaves the request hanging until the
 * request timeout.
 */
const failing = jest.fn().mockRejectedValue(new Error("connection refused"));
jest.mock("../../src/lib/prisma", () => ({
  prisma: { tenant: { findUnique: failing }, staffMember: { findFirst: failing } },
}));
jest.mock("../../src/lib/tenantContext", () => ({ tenantContext: { getTenantId: () => "store-a" } }));

import type { Request, Response } from "express";
import { requireOwner } from "../../src/middleware/requireOwner.middleware";
import { requirePermission } from "../../src/middleware/requirePermission.middleware";

const req = { params: { storeId: "store-a" }, userId: "user-1" } as unknown as Request;
const res = {} as Response;

it.each([
  ["requireOwner", requireOwner],
  ["requirePermission", requirePermission("PRODUCTS_WRITE")],
])("%s passes a database failure to the error handler", async (_name, middleware) => {
  const next = jest.fn();
  await middleware(req, res, next);
  expect(next).toHaveBeenCalledTimes(1);
  expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  expect((next.mock.calls[0][0] as Error).message).toBe("connection refused");
});
