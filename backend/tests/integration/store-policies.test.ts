/**
 * A shop's own policy pages (modules/stores/policy.service.ts): the owner writes them, anyone reads
 * them, nobody else may change them, and one shop's policies never show on another's storefront.
 */
process.env.RATE_LIMIT_ENABLED = "false";

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };

async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${path}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

async function store(tag: string) {
  const reg = await api("POST", "/auth/register", { body: { email: `verify-policy-${tag}-${suffix}@example.com`, password: "password123", storeName: `Verify policy ${tag}`, storeSlug: `verify-policy-${tag}-${suffix}`, currency: "PKR" } });
  const storeId = (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id as string;
  created.tenantIds.push(storeId);
  created.userIds.push(reg.json.user.id);
  return { token: reg.json.accessToken as string, storeId };
}

let A: Awaited<ReturnType<typeof store>>;
let B: Awaited<ReturnType<typeof store>>;

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  A = await store("a");
  B = await store("b");
}, 60_000);

afterAll(async () => {
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await prismaUnscoped.$disconnect();
});

it("a new shop has no policies", async () => {
  expect(await api("GET", `/stores/${A.storeId}/policies`)).toMatchObject({ status: 200, json: { policies: [] } });
});

it("the owner writes policies; anyone reads them, in a fixed order, as written", async () => {
  const shipping = await api("PUT", `/stores/${A.storeId}/policies/shipping`, { token: A.token, body: { body: "  We deliver across Pakistan in 3 to 5 working days.\r\n\r\nCash on delivery everywhere.  " } });
  expect(shipping).toMatchObject({ status: 200, json: { kind: "shipping", body: "We deliver across Pakistan in 3 to 5 working days.\n\nCash on delivery everywhere." } });
  await api("PUT", `/stores/${A.storeId}/policies/refund`, { token: A.token, body: { body: "Returns within 7 days, unused." } });
  // Saving again replaces the text.
  await api("PUT", `/stores/${A.storeId}/policies/refund`, { token: A.token, body: { body: "Returns within 14 days, unused. <script>alert(1)</script>" } });

  const list = await api("GET", `/stores/${A.storeId}/policies`);
  expect(list.json.policies.map((p: { kind: string }) => p.kind)).toEqual(["refund", "shipping"]);
  // Stored as text; the storefront shows it as text, so markup is harmless and kept as typed.
  expect(list.json.policies[0].body).toBe("Returns within 14 days, unused. <script>alert(1)</script>");
});

it("an empty text removes a policy", async () => {
  expect(await api("PUT", `/stores/${A.storeId}/policies/shipping`, { token: A.token, body: { body: "   " } })).toMatchObject({ status: 200, json: { kind: "shipping", body: null, updatedAt: null } });
  expect((await api("GET", `/stores/${A.storeId}/policies`)).json.policies.map((p: { kind: string }) => p.kind)).toEqual(["refund"]);
});

it("only the owner may write, an unknown kind is not found, and a very long text is refused", async () => {
  expect((await api("PUT", `/stores/${A.storeId}/policies/refund`, { body: { body: "x" } })).status).toBe(401);
  expect((await api("PUT", `/stores/${A.storeId}/policies/refund`, { token: B.token, body: { body: "Hijacked" } })).status).toBe(403);
  expect((await api("PUT", `/stores/${A.storeId}/policies/cookies`, { token: A.token, body: { body: "x" } })).status).toBe(404);
  expect((await api("PUT", `/stores/${A.storeId}/policies/terms`, { token: A.token, body: { body: "x".repeat(20_001) } })).status).toBe(400);
  expect((await api("GET", `/stores/${A.storeId}/policies`)).json.policies[0].body).toMatch(/^Returns within 14 days/);
});

it("one shop's policies never show on another's storefront", async () => {
  expect((await api("GET", `/stores/${B.storeId}/policies`)).json.policies).toEqual([]);
  expect((await api("GET", `/stores/not-a-store/policies`)).status).toBe(404);
});
