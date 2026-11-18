/**
 * scripts/seed-demo.ts refuses a database that already has real stores, and a hosted database without
 * a private password, and changes nothing there.
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

const seed = (env: NodeJS.ProcessEnv) => spawnSync(process.execPath, ["--import", "tsx", "scripts/seed-demo.ts"], { cwd: backend, env, encoding: "utf8", timeout: 60_000 });
// The password is checked before anything connects, so this address is never contacted.
const hosted = () => ({ ...process.env, DATABASE_URL: "postgresql://demo@db.example.invalid:5432/app", DEMO_PASSWORD: "" });

it.each([
  ["no password", "", /DEMO_PASSWORD must be set/],
  ["a short password", "short-one", /at least 12 characters/],
  ["the public password", "Demo-Video-2026", /public development passwords/],
])("refuses a hosted database with %s", (_name, password, message) => {
  const run = seed({ ...hosted(), DEMO_PASSWORD: password });
  expect(run.status).toBe(1);
  expect(run.stderr).toMatch(message);
  expect(run.stderr).toMatch(/Nothing was changed/);
}, 90_000);

it("never prints a private password", () => {
  const secret = "a-private-demo-password";
  const run = seed({ ...process.env, DEMO_PASSWORD: secret });
  expect(run.status).toBe(1); // this database has a real store (made above)
  expect(run.stderr).toMatch(/Refusing to seed/);
  expect(run.stdout + run.stderr).not.toContain(secret);
}, 90_000);

it("stops before touching a database that has a store which is not a demo store", async () => {
  const demoBefore = await prismaUnscoped.tenant.count({ where: { slug: "demo-scout-video-showcase" } });
  const run = seed({ ...process.env, DEMO_PASSWORD: "" });
  expect(run.status).toBe(1);
  expect(run.stderr).toMatch(/Refusing to seed/);
  expect(run.stderr).toMatch(/Nothing was changed/);
  expect(run.stdout).not.toMatch(/password/i);
  expect(await prismaUnscoped.tenant.count({ where: { slug: "demo-scout-video-showcase" } })).toBe(demoBefore);
}, 90_000);
