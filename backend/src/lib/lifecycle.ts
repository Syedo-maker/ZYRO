import type { Server } from "node:http";
import mongoose from "mongoose";
import { env } from "../config/env";
import { flushTelemetry } from "../instrumentation";
import { errorMessage, logger } from "./logger";
import { prismaUnscoped } from "./prisma";
import { getRedis } from "./redis";
import { getStorage } from "./storage";

/**
 * How a ZYRO process starts being useful and stops being useful, for both the API and the worker.
 *
 * Two probes, because they answer different questions and confusing them causes outages:
 *   - **liveness** (`/health`): is this process alive? It checks nothing outside the process. If it
 *     checked the database, a database blip would make the platform restart every API container at
 *     once, turning a short outage into a long one.
 *   - **readiness** (`/ready`): should this replica be sent traffic now? It checks every dependency
 *     the API cannot work without, and says no while shutting down, so the ingress stops routing
 *     to a replica before it goes.
 *
 * Optional services (the AI provider, Stripe, the recommendation service) are not in the readiness
 * check: the API is built to keep working without them, so their absence must not take it out.
 */

let draining = false;
export const isDraining = () => draining;

type Check = () => Promise<unknown>;

/** Each dependency the API cannot serve requests without, and the cheapest way to ask it. */
const REQUIRED: Record<string, Check> = {
  postgres: () => prismaUnscoped.$queryRaw`SELECT 1`,
  mongodb: async () => {
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) throw new Error("not connected");
    await mongoose.connection.db.admin().ping();
  },
  redis: () => getRedis().ping(),
  storage: () => getStorage().ping(),
};

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms).unref())]);

export interface Readiness {
  ready: boolean;
  checks: Record<string, "ok" | "failing">;
}

/**
 * Asks every required dependency at once, each with its own short time limit, so one hung database
 * cannot make the probe itself hang. Says which failed but never why: this answer is public.
 */
export async function readiness(only?: string[]): Promise<Readiness> {
  const names = Object.keys(REQUIRED).filter((n) => !only || only.includes(n));
  const results = await Promise.allSettled(names.map((n) => withTimeout(Promise.resolve().then(REQUIRED[n]), env.lifecycle.readinessTimeoutMs)));
  const checks: Readiness["checks"] = {};
  results.forEach((r, i) => {
    checks[names[i]] = r.status === "fulfilled" ? "ok" : "failing";
    if (r.status === "rejected") logger.warn({ dependency: names[i], err: errorMessage(r.reason) }, "readiness check failed");
  });
  return { ready: !draining && results.every((r) => r.status === "fulfilled"), checks };
}

const closers: { name: string; close: () => Promise<unknown> }[] = [];

/** Registers something to close on shutdown. Closed in reverse order of registration. */
export function onShutdown(name: string, close: () => Promise<unknown>) {
  closers.push({ name, close });
}

/**
 * Shuts down cleanly on SIGTERM (what Azure Container Apps sends before stopping a replica) and on
 * SIGINT (Ctrl+C):
 *
 *   1. Readiness turns false, so no new traffic is routed here.
 *   2. The HTTP server stops accepting connections and lets the requests in flight finish.
 *   3. Workers finish the jobs they are running (BullMQ's close waits for them), then queues, Redis,
 *      MongoDB and Postgres connections close, and buffered telemetry is sent.
 *
 * All of it inside env.lifecycle.shutdownGraceMs, which sits below the platform's own grace period
 * (30 seconds by default) so the process exits by itself rather than being killed. Whatever is still
 * running when the grace period ends is cut off and the process exits with an error code. A second
 * signal exits at once.
 */
export function installShutdown(server?: Server) {
  let started = false;
  const shutdown = async (signal: string) => {
    if (started) {
      logger.warn({ signal }, "second signal during shutdown; exiting now");
      process.exit(1);
    }
    started = true;
    draining = true;
    const grace = env.lifecycle.shutdownGraceMs;
    logger.info({ signal, graceMs: grace }, "shutting down");
    const deadline = setTimeout(() => {
      logger.error("shutdown did not finish within the grace period; exiting");
      process.exit(1);
    }, grace).unref();

    if (server) {
      // Requests in flight get most of the grace period; whatever is left over is for the rest.
      const cutOff = setTimeout(() => {
        logger.warn("requests still running at the cut-off; closing their connections");
        server.closeAllConnections();
      }, Math.floor(grace * 0.6)).unref();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      clearTimeout(cutOff);
      logger.info("HTTP server closed");
    }

    for (const { name, close } of [...closers].reverse()) {
      try {
        await close();
      } catch (err) {
        logger.warn({ resource: name, err: errorMessage(err) }, "could not close cleanly");
      }
    }
    await flushTelemetry().catch(() => undefined);
    clearTimeout(deadline);
    logger.info("shutdown complete");
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

/**
 * The last line of defence. An error nobody caught leaves the process in a state nobody planned for,
 * so it is logged with everything known about it and the process exits; the platform starts a clean
 * replacement. Carrying on would risk serving wrong answers from a half-broken process.
 */
export function installCrashHandlers() {
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason instanceof Error ? { message: reason.message, stack: reason.stack } : String(reason) }, "unhandled promise rejection");
    void flushTelemetry().finally(() => process.exit(1));
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err: { message: err.message, stack: err.stack } }, "uncaught exception");
    void flushTelemetry().finally(() => process.exit(1));
  });
}

/** The standard closers: queues and workers first (via `extra`), then Redis, MongoDB, Postgres. */
export function registerConnectionClosers() {
  onShutdown("postgres", () => prismaUnscoped.$disconnect());
  onShutdown("mongodb", () => mongoose.disconnect());
  onShutdown("redis", async () => (await import("./redis")).closeRedis());
}
