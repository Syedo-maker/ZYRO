import type { Request, RequestHandler } from "express";
import { ipKeyGenerator, rateLimit, type Options } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { env } from "../config/env";
import { getRedis } from "../lib/redis";
import { Errors } from "../errors/AppError";

const passThrough: RequestHandler = (_req, _res, next) => next();

/**
 * Builds one limiter. Counters live in Redis (shared across servers, survive restarts). If
 * Redis is unreachable the limiter lets the request through rather than taking logins down,
 * and the failure is logged.
 */
function limiter(name: string, windowMs: number, max: number, extra: Partial<Options> = {}): RequestHandler {
  if (!env.rateLimit.enabled) return passThrough;
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    passOnStoreError: true,
    store: new RedisStore({
      prefix: `${env.rateLimit.prefix}${name}:`,
      sendCommand: (command: string, ...args: string[]) =>
        getRedis().call(command, ...args) as Promise<never>,
    }),
    handler: (req, res, next) => {
      const resetTime = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
      const retryAfter = resetTime ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000)) : Math.ceil(windowMs / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      next(Errors.tooManyRequests(retryAfter));
    },
    ...extra,
  });
}

const windowMs = env.rateLimit.windowMinutes * 60 * 1000;
const clientIp = (req: Request) => ipKeyGenerator(req.ip ?? "unknown");

/** Everything under /api/v1, per IP: a broad backstop against scraping and floods. */
export const apiLimiter = limiter("api", 60 * 1000, env.rateLimit.apiMax, { keyGenerator: clientIp });

/**
 * Failed logins only (a success does not count), per email and IP: five wrong passwords
 * for one account from one address blocks further attempts for the window. Keyed on both
 * so an attacker cannot lock a victim out from a different address.
 */
export const loginAccountLimiter = limiter("login-account", windowMs, env.rateLimit.loginMax, {
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${clientIp(req)}|${String(req.body?.email ?? "").trim().toLowerCase()}`,
});

/** Failed logins per IP across all emails: stops one address trying many accounts. */
export const loginIpLimiter = limiter("login-ip", windowMs, env.rateLimit.loginIpMax, {
  skipSuccessfulRequests: true,
  keyGenerator: clientIp,
});

/** Registrations per IP per hour: slows bulk account creation. */
export const registerLimiter = limiter("register", 60 * 60 * 1000, env.rateLimit.registerMax, { keyGenerator: clientIp });

/** Silent login restore, called once per page load. */
export const refreshLimiter = limiter("refresh", windowMs, env.rateLimit.refreshMax, { keyGenerator: clientIp });

/**
 * Wrong discount codes only (an accepted code does not count), per IP: a person who fat-fingers
 * a code is never blocked, but someone guessing codes one after another is. Requests that carry
 * no code (a normal checkout) are not counted.
 */
export const discountAttemptLimiter = limiter("discount", windowMs, env.rateLimit.discountMax, {
  skipSuccessfulRequests: true,
  skip: (req) => !req.body?.code && !req.body?.discountCode,
  keyGenerator: clientIp,
});

/** Review writes per signed-in person per hour (keyed on the account, so switching address does not help); slows review spam. */
export const reviewWriteLimiter = limiter("review", 60 * 60 * 1000, env.rateLimit.reviewMax, {
  keyGenerator: (req) => (req.userId ? `u:${req.userId}` : clientIp(req)),
});

/** Chat messages per shopper per minute (keyed on the same identity as their cart: signed-in
 *  user or guest session id), not per IP: a shared address (a store, a campus) should not
 *  throttle one shopper's chat because of another's. Each message also costs AI quota, but
 *  that is monthly and store-wide; this stops one person hammering the endpoint quickly. */
export const chatMessageLimiter = limiter("chat", 60 * 1000, env.rateLimit.chatMax, {
  keyGenerator: (req) => (req.cartOwner ? `${req.cartOwner.kind}:${req.cartOwner.id}` : clientIp(req)),
});
