/**
 * Forgot and reset password (B1, 2026-11): the same answer for a registered and an unknown email, a
 * hashed single-use 30-minute token, older links retired, every session ended after a reset, the same
 * password rules as signing up, rate limits per IP and per email, and every kind of account (owner,
 * staff, shopper). Email goes through a fake gateway; no real email is sent.
 */
process.env.RATE_LIMIT_ENABLED = "true";
process.env.RATE_LIMIT_PREFIX = `rl-reset-${Date.now().toString(36)}:`;
process.env.RATE_LIMIT_FORGOT_IP_MAX = "25";
process.env.RATE_LIMIT_FORGOT_EMAIL_MAX = "3";
process.env.RATE_LIMIT_RESET_MAX = "50"; // this suite makes many resets from one address

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let env: typeof import("../../src/config/env").env;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };
const sent: { to: string; subject: string; text: string }[] = [];
const SAME = "If this email is registered, we sent a reset link. It works for 30 minutes.";
const INVALID = "This reset link is invalid or has expired. Ask for a new one.";

async function api(method: string, p: string, opts: { token?: string; body?: unknown; cookie?: string } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${p}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  if (opts.cookie) req = req.set("Cookie", opts.cookie);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body, cookies: (res.headers["set-cookie"] ?? []) as string[] };
}

/** The reset email sent to `to` after the request (sending happens after the response), and its token. */
async function linkFor(to: string, after: number): Promise<{ url: URL; token: string } | null> {
  for (let i = 0; i < 40; i++) {
    const mail = sent.slice(after).find((m) => m.to === to);
    if (mail) {
      const url = new URL(/https?:\/\/\S+/.exec(mail.text)![0]);
      return { url, token: url.searchParams.get("token")! };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

async function owner(tag: string) {
  const email = `verify-reset-${tag}-${suffix}@example.com`;
  const reg = await api("POST", "/auth/register", { body: { email, password: "old-password-1", storeName: `Reset ${tag}`, storeSlug: `verify-reset-${tag}-${suffix}` } });
  expect(reg.status).toBe(201);
  const storeId = (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id as string;
  created.tenantIds.push(storeId);
  created.userIds.push(reg.json.user.id);
  return { email, token: reg.json.accessToken as string, storeId, refreshCookie: reg.cookies.find((c) => c.startsWith("refreshToken="))!.split(";")[0] };
}

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ env } = await import("../../src/config/env"));
  (await import("../../src/lib/email")).setEmailGateway({
    async send(m) {
      sent.push(m);
    },
  });
});

afterAll(async () => {
  (await import("../../src/lib/email")).setEmailGateway(undefined);
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  const redis = (await import("../../src/lib/redis")).getRedis();
  const keys = await redis.keys(`${process.env.RATE_LIMIT_PREFIX}*`);
  if (keys.length) await redis.del(...keys);
  await (await import("../../src/lib/redis")).closeRedis();
  await prismaUnscoped.$disconnect();
});

describe("asking for a reset link", () => {
  it("answers an unknown email exactly as a registered one, and sends nothing", async () => {
    const before = sent.length;
    const res = await api("POST", "/auth/forgot-password", { body: { email: `nobody-${suffix}@example.com` } });
    expect(res.status).toBe(202);
    expect(res.json).toEqual({ message: SAME });
    await new Promise((r) => setTimeout(r, 300));
    expect(sent.length).toBe(before);
  });

  it("emails a registered owner a link to the web app, and stores only a hash of the token", async () => {
    const o = await owner("a");
    const before = sent.length;
    const res = await api("POST", "/auth/forgot-password", { body: { email: o.email } });
    expect(res.status).toBe(202);
    expect(res.json).toEqual({ message: SAME });
    const link = await linkFor(o.email, before);
    expect(link).not.toBeNull();
    expect(link!.url.origin + link!.url.pathname).toBe(`${env.storefrontUrl.replace(/\/+$/, "")}/reset-password`);
    expect(link!.token.length).toBeGreaterThanOrEqual(40);
    const rows = await prismaUnscoped.passwordResetToken.findMany({ where: { user: { email: o.email } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(link!.token);
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].expiresAt.getTime() - rows[0].createdAt.getTime()).toBe(30 * 60 * 1000);
  });

  it("refuses a malformed email with 400", async () => {
    expect((await api("POST", "/auth/forgot-password", { body: { email: "not-an-email" } })).status).toBe(400);
  });
});

describe("choosing a new password", () => {
  it("a valid link sets the new password, ends every session, and works only once", async () => {
    const o = await owner("b");
    let before = sent.length;
    await api("POST", "/auth/forgot-password", { body: { email: o.email } });
    const { token } = (await linkFor(o.email, before))!;

    const res = await api("POST", "/auth/reset-password", { body: { token, password: "new-password-2" } });
    expect(res.status).toBe(200);
    expect((await api("POST", "/auth/login", { body: { email: o.email, password: "old-password-1" } })).status).toBe(401);
    expect((await api("POST", "/auth/login", { body: { email: o.email, password: "new-password-2" } })).status).toBe(200);
    // The session from before the reset can no longer be refreshed.
    expect((await api("POST", "/auth/refresh", { cookie: o.refreshCookie })).status).toBe(401);
    // Used once: the same link is refused, with the one message for every bad link.
    const again = await api("POST", "/auth/reset-password", { body: { token, password: "another-password-3" } });
    expect(again.status).toBe(400);
    expect(again.json.detail).toBe(INVALID);
    before = sent.length;
  });

  it("an expired link is refused", async () => {
    const o = await owner("c");
    const before = sent.length;
    await api("POST", "/auth/forgot-password", { body: { email: o.email } });
    const { token } = (await linkFor(o.email, before))!;
    await prismaUnscoped.passwordResetToken.updateMany({ where: { user: { email: o.email } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await api("POST", "/auth/reset-password", { body: { token, password: "new-password-2" } });
    expect(res.status).toBe(400);
    expect(res.json.detail).toBe(INVALID);
    expect((await api("POST", "/auth/login", { body: { email: o.email, password: "old-password-1" } })).status).toBe(200);
  });

  it("asking for a new link retires the older one", async () => {
    const o = await owner("d");
    let before = sent.length;
    await api("POST", "/auth/forgot-password", { body: { email: o.email } });
    const first = (await linkFor(o.email, before))!.token;
    before = sent.length;
    await api("POST", "/auth/forgot-password", { body: { email: o.email } });
    const second = (await linkFor(o.email, before))!.token;
    expect((await api("POST", "/auth/reset-password", { body: { token: first, password: "new-password-2" } })).json.detail).toBe(INVALID);
    expect((await api("POST", "/auth/reset-password", { body: { token: second, password: "new-password-2" } })).status).toBe(200);
  });

  it("an unknown token gets the same 400", async () => {
    const res = await api("POST", "/auth/reset-password", { body: { token: "x".repeat(43), password: "new-password-2" } });
    expect(res.status).toBe(400);
    expect(res.json.detail).toBe(INVALID);
  });

  it("the new password must follow the sign-up rules (8 characters, at most 72 bytes)", async () => {
    const o = await owner("e");
    const before = sent.length;
    await api("POST", "/auth/forgot-password", { body: { email: o.email } });
    const { token } = (await linkFor(o.email, before))!;
    expect((await api("POST", "/auth/reset-password", { body: { token, password: "short" } })).status).toBe(400);
    expect((await api("POST", "/auth/reset-password", { body: { token, password: "x".repeat(73) } })).status).toBe(400);
    // A refused password does not use up the link.
    expect((await api("POST", "/auth/reset-password", { body: { token, password: "a-good-password" } })).status).toBe(200);
  });
});

describe("every kind of account", () => {
  it("a shopper resets their password, and the link can bring them back to the store they came from", async () => {
    const o = await owner("f");
    const email = `verify-reset-shopper-${suffix}@example.com`;
    const reg = await api("POST", "/auth/register-customer", { body: { email, password: "old-password-1" } });
    created.userIds.push(reg.json.user.id);
    const before = sent.length;
    await api("POST", "/auth/forgot-password", { body: { email, storeId: o.storeId } });
    const link = (await linkFor(email, before))!;
    expect(link.url.searchParams.get("store")).toBe(o.storeId);
    expect((await api("POST", "/auth/reset-password", { body: { token: link.token, password: "new-password-2" } })).status).toBe(200);
    expect((await api("POST", "/auth/login", { body: { email, password: "new-password-2" } })).status).toBe(200);
  });

  it("a staff member resets their password and keeps their role in the store", async () => {
    const o = await owner("g");
    const email = `verify-reset-staff-${suffix}@example.com`;
    const added = await api("POST", `/stores/${o.storeId}/staff`, { token: o.token, body: { email, password: "old-password-1", role: "cashier" } });
    expect(added.status).toBe(201);
    const before = sent.length;
    await api("POST", "/auth/forgot-password", { body: { email } });
    const { token } = (await linkFor(email, before))!;
    expect((await api("POST", "/auth/reset-password", { body: { token, password: "new-password-2" } })).status).toBe(200);
    const login = await api("POST", "/auth/login", { body: { email, password: "new-password-2" } });
    created.userIds.push(login.json.user.id);
    const stores = (await api("GET", "/users/me/stores", { token: login.json.accessToken })).json;
    expect(stores[0]).toMatchObject({ id: o.storeId, permissions: ["pos_sell"] });
  });

  it("a store id that is not an id is never put into the link", async () => {
    const email = `verify-reset-shopper-${suffix}@example.com`;
    const before = sent.length;
    await api("POST", "/auth/forgot-password", { body: { email, storeId: "../../evil" } });
    const link = (await linkFor(email, before))!;
    expect(link.url.searchParams.get("store")).toBeNull();
  });
});

describe("rate limits", () => {
  it("one email gets at most 3 reset requests an hour, registered or not (429 after that)", async () => {
    const email = `verify-reset-limit-${suffix}@example.com`;
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await api("POST", "/auth/forgot-password", { body: { email } })).status);
    expect(codes).toEqual([202, 202, 202, 429]);
  });

  it("one address gets a limited number of requests across all emails", async () => {
    let last = 0;
    for (let i = 0; i < 30 && last !== 429; i++) last = (await api("POST", "/auth/forgot-password", { body: { email: `verify-reset-ip-${i}-${suffix}@example.com` } })).status;
    expect(last).toBe(429);
  });
});
