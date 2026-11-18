/**
 * The web app on one site and the API on another (COOKIE_SAME_SITE=none, several CORS_ORIGIN addresses):
 * the sign-in cookie may cross sites but stays Secure and HttpOnly, only the listed sites get CORS, and
 * another site cannot use the cookie to refresh or log out.
 */
process.env.RATE_LIMIT_ENABLED = "false";
process.env.CORS_ORIGIN = "https://app.example.com, https://www.example.com/";
process.env.COOKIE_SAME_SITE = "none";

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
const email = `verify-xdomain-${Date.now().toString(36)}@example.com`;
let cookie = "";

const refreshCookie = (res: request.Response) => ((res.headers["set-cookie"] as unknown as string[]) ?? []).find((c) => c.startsWith("refreshToken=")) ?? "";

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  const res = await request(app).post("/api/v1/auth/register-customer").set("Origin", "https://app.example.com").send({ email, password: "password123" });
  expect(res.status).toBe(201);
  cookie = refreshCookie(res);
}, 60_000);

afterAll(async () => {
  await prismaUnscoped.user.deleteMany({ where: { email } });
  await prismaUnscoped.$disconnect();
});

it("the sign-in cookie may cross sites, and stays HttpOnly and Secure", () => {
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/Secure/i);
  expect(cookie).toMatch(/SameSite=None/i);
});

it("CORS answers every listed address and no other", async () => {
  for (const origin of ["https://app.example.com", "https://www.example.com"]) {
    const res = await request(app).options("/api/v1/plans").set("Origin", origin).set("Access-Control-Request-Method", "GET");
    expect(res.headers["access-control-allow-origin"]).toBe(origin);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  }
  const other = await request(app).options("/api/v1/plans").set("Origin", "https://evil.example").set("Access-Control-Request-Method", "GET");
  expect(other.headers["access-control-allow-origin"]).toBeUndefined();
});

it("another site, or no site at all, cannot use the cookie to refresh or log out", async () => {
  const value = cookie.split(";")[0];
  for (const path of ["/api/v1/auth/refresh", "/api/v1/auth/logout"]) {
    expect((await request(app).post(path).set("Cookie", value).set("Origin", "https://evil.example")).status).toBe(403);
    expect((await request(app).post(path).set("Cookie", value)).status).toBe(403);
  }
});

it("the web app refreshes the session and logs out, and the cookie is cleared with matching attributes", async () => {
  const refreshed = await request(app).post("/api/v1/auth/refresh").set("Cookie", cookie.split(";")[0]).set("Origin", "https://www.example.com");
  expect(refreshed.status).toBe(200);
  expect(refreshed.body.accessToken).toBeTruthy();
  const next = refreshCookie(refreshed);
  const out = await request(app).post("/api/v1/auth/logout").set("Cookie", next.split(";")[0]).set("Origin", "https://app.example.com");
  expect(out.status).toBe(204);
  expect(refreshCookie(out)).toMatch(/SameSite=None/i);
  expect(refreshCookie(out)).toMatch(/Secure/i);
});
