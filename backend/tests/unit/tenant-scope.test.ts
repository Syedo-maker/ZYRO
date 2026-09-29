/**
 * Phase 0 gate, multi-tenancy rule: every Postgres table that holds a store's data (it has a
 * `tenantId` column) is in the tenant-scoped list, so the Prisma extension filters every query on
 * it by the current store. A new table added without joining the list fails here, not in production.
 */
import fs from "node:fs";
import path from "node:path";
import { TENANT_SCOPED_MODELS } from "../../src/lib/prisma";

const schema = fs.readFileSync(path.resolve(__dirname, "../../prisma/schema.prisma"), "utf8");
const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1], body: m[2] }));
const withTenant = models.filter((m) => /^\s+tenantId\s+String/m.test(m.body)).map((m) => m.name);

it("finds the models", () => {
  expect(models.length).toBeGreaterThan(15);
  expect(withTenant.length).toBeGreaterThan(10);
});

it.each(withTenant)("%s has a tenantId, so it is tenant-scoped", (name) => {
  expect(TENANT_SCOPED_MODELS.has(name)).toBe(true);
});

it("every tenant-scoped model still exists and has a tenantId (no stale entries)", () => {
  for (const name of TENANT_SCOPED_MODELS) expect(withTenant).toContain(name);
});
