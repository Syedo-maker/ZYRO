import { getRedis } from "./redis";
import { logger } from "./logger";
import { onScrape } from "./metrics";

/**
 * AI cost protection beyond each store's monthly allowance (production readiness, 2026-11).
 *
 *   AI_DISABLED=true          every AI feature answers "switched off" at once (the kill switch)
 *   AI_DAILY_STORE_LIMIT=n    AI requests one store may make per UTC day (unset: 200 in production,
 *                             no limit elsewhere; 0: no limit)
 *   AI_DAILY_GLOBAL_LIMIT=n   AI requests the whole platform may make per UTC day, store and
 *                             platform-paid together (unset: 5,000 in production, no limit elsewhere;
 *                             0: no limit). A warning is logged once
 *                             usage passes 80%, so there is time to act before the limit.
 *
 * Counters live in Redis, so every API and worker instance shares them. A request answered from
 * the AI cache is free and not counted; a request that fails gives its count back. If Redis cannot
 * be reached the limits are not enforced (logged), rather than switching AI off by accident.
 */

const day = () => new Date().toISOString().slice(0, 10);
const TWO_DAYS = 2 * 24 * 60 * 60;
/**
 * The owner's decision (2026-11-14): in production the limits are on by default, 200 requests per store
 * and 5,000 for the platform each day. A setting overrides the default; 0 switches that limit off.
 * Development and tests have no default limit, so a busy test run is never refused.
 */
export const PRODUCTION_DAILY_DEFAULTS = { AI_DAILY_STORE_LIMIT: 200, AI_DAILY_GLOBAL_LIMIT: 5000 } as const;
export const limit = (name: keyof typeof PRODUCTION_DAILY_DEFAULTS) => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return process.env.NODE_ENV === "production" ? PRODUCTION_DAILY_DEFAULTS[name] : null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const aiDisabled = () => process.env.AI_DISABLED === "true";

export type DailyRefusal = "store" | "global";

/**
 * Takes one request from today's allowances. Returns a function that gives it back (for a failed
 * call), or which allowance refused it.
 */
export async function takeDailyAllowance(tenantId: string, platformPays: boolean): Promise<{ giveBack: () => Promise<void> } | { refused: DailyRefusal }> {
  const storeLimit = platformPays ? null : limit("AI_DAILY_STORE_LIMIT");
  const globalLimit = limit("AI_DAILY_GLOBAL_LIMIT");
  if (!storeLimit && !globalLimit) return { giveBack: async () => {} };

  const today = day();
  const storeKey = `ai:daily:${today}:store:${tenantId}`;
  const globalKey = `ai:daily:${today}:global`;
  const redis = getRedis();
  try {
    if (storeLimit) {
      const n = await redis.incr(storeKey);
      if (n === 1) await redis.expire(storeKey, TWO_DAYS);
      if (n > storeLimit) {
        await redis.decr(storeKey);
        return { refused: "store" };
      }
    }
    if (globalLimit) {
      const n = await redis.incr(globalKey);
      if (n === 1) await redis.expire(globalKey, TWO_DAYS);
      if (n > globalLimit) {
        await redis.decr(globalKey);
        if (storeLimit) await redis.decr(storeKey);
        return { refused: "global" };
      }
      if (n === Math.ceil(globalLimit * 0.8)) {
        logger.warn({ used: n, limit: globalLimit }, "AI usage today has passed 80% of AI_DAILY_GLOBAL_LIMIT");
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "AI daily limits could not be checked (Redis); not enforced for this request");
    return { giveBack: async () => {} };
  }
  let given = false;
  return {
    giveBack: async () => {
      if (given) return;
      given = true;
      await Promise.all([storeLimit ? redis.decr(storeKey) : null, globalLimit ? redis.decr(globalKey) : null]).catch(() => undefined);
    },
  };
}

onScrape("zyro_ai_daily_requests", "AI requests made today (UTC) across the platform, and the daily limit if set.", ["kind"], async (set) => {
  const used = Number((await getRedis().get(`ai:daily:${day()}:global`)) ?? 0);
  set({ kind: "used" }, used);
  const max = limit("AI_DAILY_GLOBAL_LIMIT");
  if (max) set({ kind: "limit" }, max);
});
