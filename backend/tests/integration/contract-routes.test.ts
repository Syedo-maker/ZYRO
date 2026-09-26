/**
 * Phase 0 gate, the code side: every path and method in openapi.yaml is answered by the real
 * server. A request with made-up ids and no sign-in may rightly get 400, 401, 403 or 404 ("Store not
 * found"); what it must never get is the server's own "Route not found", which would mean the
 * contract promises an endpoint the code does not have.
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import request from "supertest";

process.env.RATE_LIMIT_ENABLED = "false";

const spec = yaml.load(fs.readFileSync(path.resolve(__dirname, "../../openapi.yaml"), "utf8")) as {
  paths: Record<string, Record<string, unknown>>;
};
const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const routes = Object.entries(spec.paths).flatMap(([p, item]) => METHODS.filter((m) => item[m]).map((m) => [m.toUpperCase(), p] as const));

let app: import("express").Express;
beforeAll(async () => {
  app = (await import("../../src/app")).app;
});

afterAll(async () => {
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("../../src/lib/prisma")).prismaUnscoped.$disconnect();
});

it.each(routes)("%s %s exists in the server", async (method, p) => {
  // Any id-shaped value: a MongoDB-style id works for products and a plain one for everything else.
  const url = "/api/v1" + p.replace(/\{productId\}/g, "64b7f0f0f0f0f0f0f0f0f0f0").replace(/\{[^}]+\}/g, "contract-check");
  const res = await (request(app) as any)[method.toLowerCase()](url).set("Content-Type", "application/json").send("{}");
  expect(res.body?.title).not.toBe("Route not found");
});
