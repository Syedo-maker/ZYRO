/**
 * File storage failing (Blob Storage unreachable, a full disk): the caller gets a plain 503 the app
 * shows as "try again", the operator gets one log line with the operation and key, and after repeated
 * failures calls fail at once without touching the store. The readiness probe always asks the store.
 */
import { resilientStorage, type StorageDriver } from "../../src/lib/storage";
import { AppError } from "../../src/errors/AppError";

function failingDriver() {
  const calls = { put: 0, ping: 0 };
  const driver: StorageDriver = {
    name: "local",
    put: async () => {
      calls.put++;
      throw new Error("ENOSPC: no space left on device");
    },
    get: async () => null,
    remove: async () => undefined,
    removeStore: async () => undefined,
    publicUrl: (key) => `http://files.example/${key}`,
    signedUrl: async (key) => `http://files.example/${key}?sig=1`,
    ping: async () => {
      calls.ping++;
      throw new Error("down");
    },
  };
  return { driver, calls };
}

it("a failed write becomes a 503 with a plain message, never the raw error", async () => {
  const { driver } = failingDriver();
  const err = await resilientStorage(driver).put("products/s1/a.png", Buffer.from("x"), "image/png").catch((e) => e);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).status).toBe(503);
  expect((err as AppError).detail).toBe("File storage is temporarily unavailable. Please try again in a moment.");
  expect(JSON.stringify((err as AppError).toProblem())).not.toMatch(/ENOSPC/);
});

it("after repeated failures it stops calling the store, but the readiness probe still asks it", async () => {
  const { driver, calls } = failingDriver();
  const storage = resilientStorage(driver);
  for (let i = 0; i < 8; i++) await storage.put(`products/s1/${i}.png`, Buffer.from("x"), "image/png").catch(() => undefined);
  expect(calls.put).toBe(5); // then the breaker answered at once
  await expect(storage.ping()).rejects.toThrow("down");
  await expect(storage.ping()).rejects.toThrow("down");
  expect(calls.ping).toBe(2);
});

it("public addresses and successful reads pass straight through", async () => {
  const { driver } = failingDriver();
  const storage = resilientStorage(driver);
  expect(storage.publicUrl("products/s1/a.png")).toBe("http://files.example/products/s1/a.png");
  expect(await storage.get("products/s1/missing.png")).toBeNull();
});
