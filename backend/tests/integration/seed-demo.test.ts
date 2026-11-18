/**
 * scripts/seed-demo.ts refuses a database that already has real stores, and changes nothing there.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const backend = path.resolve(__dirname, "../..");
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
const suffix = Date.now().toString(36);
let tenantId = "";
let userId = "";

beforeAll(async () => {
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  const user = await prismaUnscoped.user.create({ data: { email: `verify-seed-${suffix}@example.com`, passwordHash: "not-a-real-hash" } });
  userId = user.id;
  tenantId = (await prismaUnscoped.tenant.create({ data: { name: "A real shop", slug: `verify-seed-${suffix}`, ownerId: user.id } })).id;
});

afterAll(async () => {
  await prismaUnscoped.tenant.deleteMany({ where: { id: tenantId } });
  await prismaUnscoped.user.deleteMany({ where: { id: userId } });
  await prismaUnscoped.$disconnect();
});

it("stops before touching a database that has a store which is not a demo store", async () => {
  const demoBefore = await prismaUnscoped.tenant.count({ where: { slug: "demo-scout-video-showcase" } });
  const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/seed-demo.ts"], { cwd: backend, env: process.env, encoding: "utf8", timeout: 60_000 });
  expect(run.status).toBe(1);
  expect(run.stderr).toMatch(/Refusing to seed/);
  expect(run.stderr).toMatch(/Nothing was changed/);
  expect(run.stdout).not.toMatch(/password/i);
  expect(await prismaUnscoped.tenant.count({ where: { slug: "demo-scout-video-showcase" } })).toBe(demoBefore);
}, 90_000);
