/**
 * The shutdown sequence (src/lib/lifecycle.ts), run by calling the handler a signal would call.
 * Windows cannot deliver SIGTERM to a Node process, and a test must not really exit, so the
 * registered listener is invoked directly and process.exit is replaced with a recorder. The real
 * signal, in a real Linux container, is tested against the production image (Phase 3 gate).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

type Lifecycle = typeof import("../../src/lib/lifecycle");

/** A fresh copy of the module (its draining flag and closers are module state) with its own settings. */
function freshLifecycle(env: Record<string, string> = {}): Lifecycle {
  Object.assign(process.env, env);
  let mod!: Lifecycle;
  jest.isolateModules(() => {
    mod = require("../../src/lib/lifecycle");
  });
  return mod;
}

const exits: number[] = [];
let exitSpy: jest.SpyInstance;
const before: Record<string, Function[]> = {};
const SIGNALS = ["SIGTERM", "SIGINT", "unhandledRejection", "uncaughtException"] as const;

beforeEach(() => {
  exits.length = 0;
  exitSpy = jest.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exits.push(code ?? 0);
  }) as never);
  for (const s of SIGNALS) before[s] = process.listeners(s as any).slice();
});

afterEach(() => {
  exitSpy.mockRestore();
  // Remove only the listeners these tests added.
  for (const s of SIGNALS) for (const l of process.listeners(s as any)) if (!before[s].includes(l)) process.removeListener(s as any, l as any);
});

const added = (signal: (typeof SIGNALS)[number]) => process.listeners(signal as any).filter((l) => !before[signal].includes(l)).at(-1) as (...args: unknown[]) => void;
const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));

async function listeningServer() {
  const server = http.createServer((_req, res) => res.end("ok"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return server;
}

describe("graceful shutdown", () => {
  it("on SIGTERM: stops taking traffic, closes the server, closes everything in reverse order, exits 0", async () => {
    const life = freshLifecycle({ SHUTDOWN_GRACE_MS: "5000" });
    const server = await listeningServer();
    const port = (server.address() as AddressInfo).port;
    const order: string[] = [];
    life.onShutdown("first", async () => void order.push("first"));
    life.onShutdown("second", async () => void order.push("second"));
    life.installShutdown(server);

    expect(life.isDraining()).toBe(false);
    added("SIGTERM")();
    expect(life.isDraining()).toBe(true);
    await settle(200);

    expect(order).toEqual(["second", "first"]);
    expect(exits).toEqual([0]);
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  });

  it("a resource that will not close does not stop the others", async () => {
    const life = freshLifecycle({ SHUTDOWN_GRACE_MS: "5000" });
    const closed: string[] = [];
    life.onShutdown("good", async () => void closed.push("good"));
    life.onShutdown("bad", async () => {
      throw new Error("connection already gone");
    });
    life.installShutdown();
    added("SIGINT")();
    await settle(100);
    expect(closed).toEqual(["good"]);
    expect(exits).toEqual([0]);
  });

  it("a second signal during shutdown exits at once, with an error code", async () => {
    const life = freshLifecycle({ SHUTDOWN_GRACE_MS: "5000" });
    life.onShutdown("slow", () => new Promise((r) => setTimeout(r, 300)));
    life.installShutdown();
    const handler = added("SIGTERM");
    handler();
    handler();
    expect(exits).toEqual([1]);
    await settle(400);
  });

  it("whatever is still running at the end of the grace period is cut off, and the exit says so", async () => {
    const life = freshLifecycle({ SHUTDOWN_GRACE_MS: "150" });
    life.onShutdown("stuck", () => new Promise(() => undefined));
    life.installShutdown();
    added("SIGTERM")();
    await settle(300);
    expect(exits).toEqual([1]);
  });

  it("readiness says no while draining, whatever the dependencies say", async () => {
    const life = freshLifecycle({ SHUTDOWN_GRACE_MS: "5000" });
    life.onShutdown("slow", () => new Promise((r) => setTimeout(r, 200)));
    life.installShutdown();
    added("SIGTERM")();
    const result = await life.readiness([]);
    expect(result.ready).toBe(false);
    // Let the shutdown finish while process.exit is still the recorder: a real exit after this
    // test would end the whole test run.
    await settle(400);
    expect(exits).toEqual([0]);
  });
});

describe("crashes", () => {
  it("an unhandled rejection is logged and the process exits with an error code", async () => {
    const life = freshLifecycle();
    life.installCrashHandlers();
    added("unhandledRejection")(new Error("nobody caught this"));
    await settle();
    expect(exits).toEqual([1]);
  });

  it("an uncaught exception does the same", async () => {
    const life = freshLifecycle();
    life.installCrashHandlers();
    added("uncaughtException")(new Error("boom"));
    await settle();
    expect(exits).toEqual([1]);
  });
});
