/**
 * Checks the abuse and password protections against the real API, Redis and databases:
 * brute-force limits on login and registration, response headers, timing, password rules,
 * malformed requests, and startup safety. Uses tight limits and a private Redis key prefix
 * so it never disturbs (or is disturbed by) real counters. Creates and removes its own users.
 * Usage: npx tsx scripts/verify-security.ts
 */
process.env.RATE_LIMIT_ENABLED = "true";
process.env.RATE_LIMIT_PREFIX = `rl-test-${Date.now().toString(36)}:`;
process.env.RATE_LIMIT_LOGIN_MAX = "5";
process.env.RATE_LIMIT_LOGIN_IP_MAX = "12";
// The test makes exactly 6 registration attempts (rejected ones count too); the 7th must be blocked.
process.env.RATE_LIMIT_REGISTER_MAX = "6";
process.env.RATE_LIMIT_REFRESH_MAX = "1000";
process.env.RATE_LIMIT_API_MAX = "1000";
process.env.RATE_LIMIT_DISCOUNT_MAX = "5";
process.env.RATE_LIMIT_WINDOW_MINUTES = "15";

import type { AddressInfo } from "node:net";
import { spawnSync } from "node:child_process";

let failures = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
}

async function main() {
  const { app } = await import("../src/app");
  const { prismaUnscoped } = await import("../src/lib/prisma");
  const { getRedis, closeRedis } = await import("../src/lib/redis");
  const { connectMongo } = await import("../src/lib/mongo");
  const mongoose = (await import("mongoose")).default;
  await connectMongo();

  const server = app.listen(0);
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const base = `${origin}/api/v1`;

  async function call(method: string, path: string, opts: { body?: unknown; raw?: string; headers?: Record<string, string> } = {}) {
    const started = performance.now();
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
      body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: res.status, json, headers: res.headers, ms: performance.now() - started };
  }

  const suffix = Date.now().toString(36);
  const emails: string[] = [];
  const slugs: string[] = [];
  const reg = (tag: string, password = "password123") => {
    const email = `sec-${tag}-${suffix}@example.com`;
    emails.push(email);
    slugs.push(`sec-${tag}-${suffix}`);
    return call("POST", "/auth/register", { body: { email, password, storeName: `Sec ${tag}`, storeSlug: `sec-${tag}-${suffix}` } });
  };

  try {
    // ---- Response headers ----
    const health = await fetch(`${origin}/health`);
    const h = health.headers;
    check("headers: X-Powered-By is gone (does not advertise Express)", h.get("x-powered-by") === null);
    check("headers: nosniff, frame protection and HSTS are set", h.get("x-content-type-options") === "nosniff" && !!h.get("x-frame-options") && !!h.get("strict-transport-security"));
    check("headers: a Content-Security-Policy is set", !!h.get("content-security-policy"));
    check("headers: uploaded images can still be embedded by the storefront (cross-origin resource policy)", h.get("cross-origin-resource-policy") === "cross-origin");

    // ---- Malformed requests ----
    const badJson = await call("POST", "/auth/login", { raw: '{"email": broken' });
    check("errors: malformed JSON is a 400 problem, not a 500", badJson.status === 400 && (badJson.headers.get("content-type") ?? "").includes("problem+json"));
    const huge = await call("POST", "/auth/login", { raw: JSON.stringify({ email: "a@b.co", password: "x".repeat(300_000) }) });
    check("errors: an oversized body is a 413, not a 500", huge.status === 413, `status=${huge.status}`);

    // ---- Password rules ----
    const okReg = await reg("ok");
    check("password: a normal password registers", okReg.status === 201);
    const long73 = await reg("long", "a".repeat(73));
    check("password: over 72 bytes is rejected (bcrypt would silently ignore the rest)", long73.status === 400);
    const multibyte = await reg("mb", "é".repeat(37)); // 74 bytes, 37 characters
    check("password: the limit counts bytes, so 37 accented characters (74 bytes) are rejected", multibyte.status === 400);
    check("password: exactly 72 bytes is accepted", (await reg("edge", "a".repeat(72))).status === 201);
    check("password: a 254+ character email is rejected", (await call("POST", "/auth/register", { body: { email: `${"a".repeat(250)}@example.com`, password: "password123", storeName: "x", storeSlug: `sec-em-${suffix}` } })).status === 400);

    // ---- Timing: no account enumeration ----
    const realWrong = await call("POST", "/auth/login", { body: { email: emails[0], password: "wrong-password-1" } });
    const unknown = await call("POST", "/auth/login", { body: { email: `ghost-${suffix}@example.com`, password: "wrong-password-1" } });
    check("timing: an unknown email takes about as long as a wrong password (both run a full password check)", unknown.ms > realWrong.ms * 0.5, `unknown=${Math.round(unknown.ms)}ms known=${Math.round(realWrong.ms)}ms`);
    check("timing: responses are identical in shape", realWrong.status === 401 && unknown.status === 401 && realWrong.json.title === unknown.json.title);

    // ---- Login lockout (5 failures per email and IP) ----
    const victim = `sec-victim-${suffix}@example.com`;
    emails.push(victim);
    slugs.push(`sec-victim-${suffix}`);
    await call("POST", "/auth/register", { body: { email: victim, password: "correct-horse-1", storeName: "V", storeSlug: `sec-victim-${suffix}` } });
    for (let i = 1; i <= 4; i++) await call("POST", "/auth/login", { body: { email: victim, password: `wrong-${i}` } });
    // 5th and 6th failures: the 5th is allowed and fails normally, the 6th is blocked
    const fifth = await call("POST", "/auth/login", { body: { email: victim, password: "wrong-5" } });
    const sixth = await call("POST", "/auth/login", { body: { email: victim, password: "wrong-6" } });
    check("lockout: the 5th wrong password is still an ordinary 401", fifth.status === 401);
    check("lockout: the 6th attempt is blocked with 429 and a problem+json body", sixth.status === 429 && (sixth.headers.get("content-type") ?? "").includes("problem+json") && sixth.json.title === "Too many attempts");
    const retry = Number(sixth.headers.get("retry-after"));
    check("lockout: Retry-After tells the client how long to wait (about 15 minutes)", retry > 800 && retry <= 900, `retry-after=${retry}s`);
    const correctWhileLocked = await call("POST", "/auth/login", { body: { email: victim, password: "correct-horse-1" } });
    check("lockout: even the correct password is refused while locked, so guessing cannot succeed", correctWhileLocked.status === 429);
    check("lockout: another account from the same address is unaffected", (await call("POST", "/auth/login", { body: { email: emails[0], password: "password123" } })).status === 200);
    check("lockout: the lock is stored in Redis (survives a server restart)", (await getRedis().keys(`${process.env.RATE_LIMIT_PREFIX}login-account:*`)).length >= 1);

    // ---- Successful logins do not count ----
    const good = emails[0];
    let allOk = true;
    for (let i = 0; i < 8; i++) if ((await call("POST", "/auth/login", { body: { email: good, password: "password123" } })).status !== 200) allOk = false;
    check("lockout: successful logins never count against the limit (8 in a row all work)", allOk);

    // ---- Per-IP failed-login cap across many emails ----
    let blockedAt = 0;
    for (let i = 1; i <= 20 && !blockedAt; i++) {
      const r = await call("POST", "/auth/login", { body: { email: `stuff-${i}-${suffix}@example.com`, password: "x" } });
      if (r.status === 429) blockedAt = i;
    }
    check("credential stuffing: trying many different emails from one address gets blocked too", blockedAt > 0, `blocked after ${blockedAt + 6} total failures from this address`);

    // ---- Registration cap ----
    const regAfter = await call("POST", "/auth/register", { body: { email: `sec-late-${suffix}@example.com`, password: "password123", storeName: "L", storeSlug: `sec-late-${suffix}` } });
    check("registration: a burst of sign-ups from one address is capped (429)", regAfter.status === 429, `status=${regAfter.status}`);
    emails.push(`sec-late-${suffix}@example.com`);

    // ---- Guessing discount codes ----
    // Any store id works: a code that does not exist is a wrong guess whether or not the store does.
    const guessAs = (code: string, ip: string) =>
      call("POST", "/stores/some-store/discount-codes/validate", { body: { code, cartTotal: 50 }, headers: { "X-Guest-Session-Id": `guest-${suffix}-guessing-aaaa`, "X-Forwarded-For": ip } });
    const guesses = [];
    for (let i = 1; i <= 5; i++) guesses.push(await guessAs(`GUESS${i}`, "203.0.113.7"));
    check("discount codes: five wrong guesses are each a plain 400", guesses.every((g) => g.status === 400));
    const sixthGuess = await guessAs("GUESS6", "203.0.113.7");
    check("discount codes: the sixth wrong guess from one address is blocked (429) with a wait time", sixthGuess.status === 429 && Number(sixthGuess.headers.get("retry-after")) > 0, `status=${sixthGuess.status}`);
    const checkoutWhileBlocked = await call("POST", "/stores/some-store/checkout/quote", { body: {}, headers: { "X-Guest-Session-Id": `guest-${suffix}-guessing-aaaa` } });
    check("discount codes: a normal checkout request (no code) is never counted or blocked", checkoutWhileBlocked.status !== 429);
    const guessWithCode = await call("POST", "/stores/some-store/checkout/quote", { body: { discountCode: "GUESS7" }, headers: { "X-Guest-Session-Id": `guest-${suffix}-guessing-aaaa` } });
    check("discount codes: guessing through checkout counts against the same limit", guessWithCode.status === 429);

    // ---- The limiter must not take the site down ----
    check("resilience: normal read endpoints still work while auth is limited", (await call("GET", "/stores/none")).status === 404);
  } finally {
    for (const s of slugs) await prismaUnscoped.tenant.deleteMany({ where: { slug: s } });
    for (const e of emails) await prismaUnscoped.user.deleteMany({ where: { email: e } });
    const redis = getRedis();
    const keys = await redis.keys(`${process.env.RATE_LIMIT_PREFIX}*`);
    if (keys.length) await redis.del(...keys);
    server.close();
  }

  // ---- Startup safety (separate processes, because config is read at start) ----
  const run = (env: Record<string, string>) =>
    spawnSync(process.execPath, ["--import", "tsx", "-e", 'import("./src/config/env").then(()=>console.log("STARTED"))'], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
  const weak = run({ NODE_ENV: "production", JWT_ACCESS_SECRET: "replace-with-a-long-random-string" });
  check("startup: production refuses to start with the placeholder JWT secret", !weak.stdout.includes("STARTED") && /JWT_ACCESS_SECRET/.test(weak.stderr));
  const short = run({ NODE_ENV: "production", JWT_ACCESS_SECRET: "tooshort" });
  check("startup: production refuses a short JWT secret", !short.stdout.includes("STARTED"));
  const strong = run({ NODE_ENV: "production", JWT_ACCESS_SECRET: "k9Tq2vL8xR4mZ7nB1cW6yH3sD5fG0jPa8uE2iO4tY6r" });
  check("startup: production starts with a strong secret", strong.stdout.includes("STARTED"), (strong.stderr || "").split("\n")[0]);
  const dev = run({ NODE_ENV: "development", JWT_ACCESS_SECRET: "dev-only-secret" });
  check("startup: development still allows the simple dev secret", dev.stdout.includes("STARTED"));

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  await closeRedis();
  await mongoose.disconnect();
  await prismaUnscoped.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
