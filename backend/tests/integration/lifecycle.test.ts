/**
 * Production hardening (Production_Readiness.md, Phase 3): every request ends, the probes answer the
 * right questions, private file links cannot be forged or reused after they expire, an upload's type
 * comes from its bytes, and no connection string reaches a log line.
 *
 * Graceful shutdown on SIGTERM is not tested here: Windows cannot deliver SIGTERM to a Node process,
 * so it is checked against the production image in Linux containers instead (see the Phase 3 gate).
 */
process.env.RATE_LIMIT_ENABLED = "false";
process.env.REQUEST_TIMEOUT_MS = "150";

import express from "express";
import request from "supertest";
import type { Express } from "express";

let app: Express;

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  await (await import("../../src/lib/mongo")).connectMongo();
}, 60_000);

afterAll(async () => {
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await (await import("../../src/lib/prisma")).prismaUnscoped.$disconnect();
});

describe("every request ends", () => {
  it("a handler that never answers gets a 503 with Retry-After, and a late answer is dropped safely", async () => {
    const { requestTimeout } = await import("../../src/middleware/timeout.middleware");
    const slow = express();
    let lateSendFailed = false;
    slow.use(requestTimeout);
    slow.get("/stuck", (_req, res) => {
      setTimeout(() => {
        try {
          res.json({ late: true });
        } catch {
          lateSendFailed = true;
        }
      }, 300);
    });
    const res = await request(slow).get("/stuck");
    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("5");
    expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(res.body.type).toBe("https://zyro.dev/errors/request-timeout");
    // It never claims nothing happened: the work may still finish.
    expect(res.body.detail).toMatch(/may still finish/);
    await new Promise((r) => setTimeout(r, 400));
    expect(lateSendFailed).toBe(true);
  });

  it("a fast request is untouched by the timeout", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });

  it("an error response carries the request id too, so it can be quoted to support", async () => {
    const res = await request(app).get("/api/v1/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a request id sent in by the caller is kept, and a malformed one is replaced", async () => {
    expect((await request(app).get("/health").set("X-Request-Id", "abc12345-trace")).headers["x-request-id"]).toBe("abc12345-trace");
    expect((await request(app).get("/health").set("X-Request-Id", "<script>")).headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("probes", () => {
  it("liveness checks nothing outside the process", async () => {
    const res = await request(app).get("/health");
    expect(res.body).toEqual({ status: "ok" });
  });

  it("readiness checks every required dependency and names each", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready", checks: { postgres: "ok", mongodb: "ok", redis: "ok", storage: "ok" } });
  });
});

describe("private file links", () => {
  it("a genuine, current link verifies; a changed key, signature or expiry does not; an expired one does not", async () => {
    const { getStorage, verifyFileLink } = await import("../../src/lib/storage");
    const key = "receipts/store1/0f8fad5b-d9cb-469f-a165-70867728950e.png";
    const url = new URL(await getStorage().signedUrl(key, 60));
    const expires = Number(url.searchParams.get("expires"));
    const signature = url.searchParams.get("signature")!;
    expect(verifyFileLink(key, expires, signature)).toBe(true);
    expect(verifyFileLink(key.replace("store1", "store2"), expires, signature)).toBe(false);
    expect(verifyFileLink(key, expires + 1, signature)).toBe(false);
    expect(verifyFileLink(key, expires, signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A"))).toBe(false);
    const past = new URL(await getStorage().signedUrl(key, -10));
    expect(verifyFileLink(key, Number(past.searchParams.get("expires")), past.searchParams.get("signature")!)).toBe(false);
  });

  it("only keys of our own shape are accepted, so nothing can point outside the storage area", async () => {
    const { isStorageKey } = await import("../../src/lib/storage");
    expect(isStorageKey("voice/abc/0f8fad5b-d9cb-469f-a165-70867728950e.webm")).toBe(true);
    for (const bad of ["../.env", "receipts/../../.env", "receipts/a/b.png", "other/a/0f8fad5b-d9cb-469f-a165-70867728950e.png", "receipts/a b/0f8fad5b-d9cb-469f-a165-70867728950e.png"]) {
      expect(isStorageKey(bad)).toBe(false);
    }
  });
});

describe("upload types come from the bytes", () => {
  it("recognises JPEG, PNG and WebP, and nothing else", async () => {
    const { sniffImage } = await import("../../src/lib/storage");
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))?.ext).toBe(".jpg");
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.ext).toBe(".png");
    expect(sniffImage(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]))?.ext).toBe(".webp");
    expect(sniffImage(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffImage(Buffer.from("GIF89a"))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});

describe("no connection string in the logs", () => {
  it("only the MongoDB host is ever logged, never the user or password", async () => {
    const { mongoHost } = await import("../../src/lib/mongo");
    expect(mongoHost("mongodb+srv://zyro:S3cret!@cluster0.abcde.mongodb.net/zyro?retryWrites=true")).toBe("cluster0.abcde.mongodb.net");
    expect(mongoHost("mongodb://localhost:27017/zyro")).toBe("localhost:27017");
    expect(mongoHost("not a uri")).toBe("(unparsed)");
  });
});
