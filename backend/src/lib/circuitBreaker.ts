import { logger } from "./logger";
import { externalCalls, onScrape } from "./metrics";

/**
 * A circuit breaker for calls to outside services (production readiness, 2026-11).
 *
 * Every outside call already has a timeout (Stripe 20 s, AI 25 s, email 10 s, recommendations 4 s).
 * A timeout alone still makes every request wait that long while a provider is down, and keeps
 * hammering it. The breaker counts consecutive failures; after `threshold` of them it opens, and for
 * `openMs` every call fails at once with the caller's own "unavailable" error, so the app answers
 * immediately with its usual friendly message. Then one trial call goes through (half-open): success
 * closes the breaker, failure opens it again. Each state change is logged once for the operator.
 *
 * State is per process: each API or worker instance learns on its own, which is enough for this and
 * needs no shared storage.
 */

export type BreakerState = "closed" | "open" | "half-open";

export interface BreakerOptions {
  /** Consecutive failures that open the breaker (default 5). */
  threshold?: number;
  /** How long it stays open before one trial call (default 30 s). */
  openMs?: number;
  /** The error thrown while open: the same kind callers already handle for this service. */
  openError?: (name: string, retryInMs: number) => Error;
  /** Which errors count as the service failing (default all). A caller's own mistake should not. */
  countsAsFailure?: (err: unknown) => boolean;
  now?: () => number;
}

export class CircuitOpenError extends Error {
  constructor(
    readonly breaker: string,
    readonly retryInMs: number
  ) {
    super(`${breaker} is unavailable (circuit open, next try in ${Math.ceil(retryInMs / 1000)} s)`);
    this.name = "CircuitOpenError";
  }
}

export interface Breaker {
  readonly name: string;
  run<T>(call: () => Promise<T>): Promise<T>;
  state(): BreakerState;
  /** For metrics and tests. */
  snapshot(): { name: string; state: BreakerState; consecutiveFailures: number; openedAt: number | null };
}

const registry = new Map<string, Breaker>();

/** Every breaker in this process, for the metrics endpoint. */
export const breakerSnapshots = () => [...registry.values()].map((b) => b.snapshot());

onScrape("zyro_circuit_open", "1 while an outside service's circuit breaker is open (calls fail at once).", ["service"], (set) => {
  for (const b of breakerSnapshots()) set({ service: b.name }, b.state === "closed" ? 0 : 1);
});

export function createBreaker(name: string, options: BreakerOptions = {}): Breaker {
  const threshold = options.threshold ?? 5;
  const openMs = options.openMs ?? 30_000;
  const now = options.now ?? Date.now;
  const counts = options.countsAsFailure ?? (() => true);
  let failures = 0;
  let openedAt: number | null = null;
  let trialInFlight = false;

  const state = (): BreakerState => {
    if (openedAt === null) return "closed";
    return now() - openedAt >= openMs ? "half-open" : "open";
  };

  const breaker: Breaker = {
    name,
    state,
    snapshot: () => ({ name, state: state(), consecutiveFailures: failures, openedAt }),
    async run<T>(call: () => Promise<T>): Promise<T> {
      const current = state();
      if (current === "open" || (current === "half-open" && trialInFlight)) {
        externalCalls.inc({ service: name, outcome: "open" });
        const retryInMs = Math.max(0, openMs - (now() - (openedAt ?? now())));
        throw options.openError ? options.openError(name, retryInMs) : new CircuitOpenError(name, retryInMs);
      }
      const isTrial = current === "half-open";
      if (isTrial) trialInFlight = true;
      try {
        const result = await call();
        externalCalls.inc({ service: name, outcome: "ok" });
        if (openedAt !== null) logger.info({ breaker: name }, `${name} is answering again: circuit closed`);
        failures = 0;
        openedAt = null;
        return result;
      } catch (err) {
        externalCalls.inc({ service: name, outcome: counts(err) ? "failed" : "caller_error" });
        if (counts(err)) {
          failures += 1;
          if (isTrial || failures >= threshold) {
            if (openedAt === null || isTrial) {
              logger.warn({ breaker: name, consecutiveFailures: failures, openSeconds: openMs / 1000 }, `${name} keeps failing: circuit open, calls fail at once for ${openMs / 1000} s`);
            }
            openedAt = now();
          }
        }
        throw err;
      } finally {
        if (isTrial) trialInFlight = false;
      }
    },
  };
  registry.set(name, breaker);
  return breaker;
}

/**
 * Wraps the methods of a service client (a gateway object or class instance) so its calls go through
 * the breaker. `skip` names methods that make no outside call (a local, synchronous signature check,
 * say): they are passed through untouched, as are non-function properties.
 */
export function guard<T extends object>(breaker: Breaker, target: T, options: { skip?: (keyof T)[] } = {}): T {
  const skip = new Set<PropertyKey>(options.skip ?? []);
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if (typeof value !== "function" || skip.has(prop)) return typeof value === "function" ? value.bind(obj) : value;
      return (...args: unknown[]) => breaker.run(() => Promise.resolve(value.apply(obj, args)));
    },
  });
}
