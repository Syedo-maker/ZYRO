/**
 * Issue 2's central claim, checked against every endpoint the contract declares rather than a
 * hand-picked few: **the server, not the browser, decides who may do what.**
 *
 * The admin pages are hidden from a shopper, but hiding a menu item protects nothing. So every
 * operation in openapi.yaml is called here with no credentials at all, and has to turn the caller
 * away. An endpoint that answers a stranger with data is either a hole or a public endpoint nobody
 * declared, and either way this should fail until somebody deals with it deliberately.
 *
 * Why the contract drives it: the alternative is a list of routes in this file, which would go
 * stale the first time somebody adds one. The spec already has to say what each endpoint needs, and
 * `contract-routes.test.ts` already proves the spec and the code agree about which endpoints exist.
 *
 * Three kinds of endpoint, three expectations:
 *
 * - **Needs a bearer token** (the default, from the global `security`): must answer 401 or 403.
 *   `requireAuth` stops the request before any handler runs, and `requireOwner` or
 *   `requirePermission` then works the role out per request and per shop.
 * - **Satisfiable by a guest session** (`guestSession`: the cart, checkout, the shopping assistant):
 *   a shopper with no account is identified by their `X-Guest-Session-Id` header, so a caller who
 *   sends nothing at all is turned away with a 400 instead. What matters is that **no data comes
 *   back**, so anything but a 2xx passes.
 * - **Declared public** (`security: []`): skipped. Those are listed in the test output so the list
 *   itself stays visible and has to be justified when it grows.
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import request from "supertest";

process.env.RATE_LIMIT_ENABLED = "false";

type Operation = { security?: Record<string, unknown>[]; operationId?: string };
const spec = yaml.load(fs.readFileSync(path.resolve(__dirname, "../../openapi.yaml"), "utf8")) as {
  security?: Record<string, unknown>[];
  paths: Record<string, Record<string, Operation>>;
};

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const GLOBAL = spec.security ?? [];

/** The alternatives a caller may satisfy: the operation's own list, or the global one. */
const alternatives = (op: Operation) => op.security ?? GLOBAL;

/** `security: []` on the operation: deliberately open to anyone. */
const isPublic = (op: Operation) => Array.isArray(op.security) && op.security.length === 0;

/** True when some alternative asks for nothing a token can carry, so a header-only shopper fits. */
const guestCanSatisfy = (op: Operation) =>
  alternatives(op).some((alt) => {
    const schemes = Object.keys(alt);
    return schemes.length === 0 || schemes.every((s) => s !== "bearerAuth");
  });

const classified = Object.entries(spec.paths).flatMap(([p, item]) =>
  METHODS.filter((m) => item[m]).map((m) => {
    const op = item[m];
    return {
      method: m.toUpperCase(),
      path: p,
      id: op.operationId ?? "?",
      kind: isPublic(op) ? ("public" as const) : guestCanSatisfy(op) ? ("guest" as const) : ("token" as const),
    };
  })
);

/**
 * One documented exception, with its own test below rather than a quiet loosening of the rule.
 *
 * `cart_merge` does need a signed-in shopper, and its handler refuses anyone else. But it sits on
 * the cart router, whose shared `resolveCartOwner` works out whose cart a request is about before
 * any route runs, and turns away a caller carrying neither a token nor a guest session id with a
 * 400. So a stranger is refused, just not with a 401. Nothing leaks either way, and reordering a
 * working, tested router to change which refusal a stranger sees would be a poor trade.
 */
const DOOR_IS_THE_CART_CHAIN = new Set(["cart_merge"]);

const needsToken = classified.filter((r) => r.kind === "token" && !DOOR_IS_THE_CART_CHAIN.has(r.id)).map((r) => [r.method, r.path, r.id] as const);
const guestReachable = classified.filter((r) => r.kind === "guest").map((r) => [r.method, r.path, r.id] as const);
const publicOps = classified.filter((r) => r.kind === "public");

let app: import("express").Express;
beforeAll(async () => {
  app = (await import("../../src/app")).app;
});

afterAll(async () => {
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("../../src/lib/prisma")).prismaUnscoped.$disconnect();
});

/** No credentials of any kind: not a token, not a guest session id, not a cookie. */
async function callAsStranger(method: string, p: string) {
  const url = "/api/v1" + p.replace(/\{productId\}/g, "64b7f0f0f0f0f0f0f0f0f0f0").replace(/\{[^}]+\}/g, "role-check");
  return (request(app) as any)[method.toLowerCase()](url).set("Content-Type", "application/json").send("{}");
}

it("the contract still classifies a realistic number of endpoints, so this file cannot pass vacuously", () => {
  expect(needsToken.length).toBeGreaterThan(80);
  expect(guestReachable.length).toBeGreaterThan(0);
  // Printed on purpose: the public list is the one that matters to read, and it should stay short.
  console.log(`public by declaration (${publicOps.length}): ${publicOps.map((o) => o.id).join(", ")}`);
});

it.each(needsToken)("%s %s (%s) refuses a caller with no credentials", async (method, p) => {
  const res = await callAsStranger(method, p);
  expect([401, 403]).toContain(res.status);
});

it.each(guestReachable)("%s %s (%s) gives a caller with no credentials nothing", async (method, p) => {
  const res = await callAsStranger(method, p);
  expect(res.status).toBeGreaterThanOrEqual(400);
});

/** The exception above, stated as assertions instead of taken on trust. */
describe("cart_merge, the one endpoint whose door is the cart chain", () => {
  it("turns away a caller carrying nothing, and returns no cart", async () => {
    const res = await callAsStranger("POST", "/stores/{storeId}/cart/merge");
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty("items");
    expect(res.body).not.toHaveProperty("lines");
  });

  it("refuses a guest who is not signed in, however valid their guest session is", async () => {
    const res = await request(app)
      .post("/api/v1/stores/role-check/cart/merge")
      .set("Content-Type", "application/json")
      .set("X-Guest-Session-Id", "abcdefghijklmnop1234")
      .send("{}");
    expect(res.status).toBe(401);
  });

  it("refuses an invalid token rather than quietly treating the caller as a guest", async () => {
    const res = await request(app)
      .post("/api/v1/stores/role-check/cart/merge")
      .set("Content-Type", "application/json")
      .set("Authorization", "Bearer not-a-real-token")
      .set("X-Guest-Session-Id", "abcdefghijklmnop1234")
      .send("{}");
    expect(res.status).toBe(401);
  });
});
