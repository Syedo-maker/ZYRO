/**
 * The walkthrough videos' one exception to "demo stores are never in the shop directory": a
 * development machine may name one demo store in DIRECTORY_SHOWCASE_DEMO_SLUG, and only that store
 * is listed. Every other demo store stays out, as before.
 */
const suffix = Date.now().toString(36);
const SHOWCASE = `demo-scout-verify-showcase-${suffix}`;
process.env.DIRECTORY_SHOWCASE_DEMO_SLUG = SHOWCASE;
process.env.RATE_LIMIT_ENABLED = "false";

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let Product: typeof import("../../src/models/Product.model").Product;
const created = { tenantIds: [] as string[], userIds: [] as string[] };

async function demoStore(slug: string, name: string) {
  const user = await prismaUnscoped.user.create({ data: { email: `${slug}@demo.zyro.local`, passwordHash: "x" } });
  const tenant = await prismaUnscoped.tenant.create({ data: { name, slug, ownerId: user.id, currency: "PKR", listedInDirectory: true } });
  created.userIds.push(user.id);
  created.tenantIds.push(tenant.id);
  // The directory lists a shop once it has three products.
  for (const title of ["Clay Cup", "Copper Kettle", "Steel Pot"]) {
    await new Product({ storeId: tenant.id, title, category: "Kitchen", actualPrice: 500, salePrice: 500 }).save();
  }
  return tenant;
}

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ Product } = await import("../../src/models/Product.model"));
  await (await import("../../src/lib/mongo")).connectMongo();
  await demoStore(SHOWCASE, `Demo showcase ${suffix}`);
  await demoStore(`demo-scout-verify-other-${suffix}`, `Demo other ${suffix}`);
}, 60_000);

afterAll(async () => {
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const id of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id } });
  for (const id of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id } });
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
  process.env.DIRECTORY_SHOWCASE_DEMO_SLUG = "";
});

const listed = async (q?: string) => {
  const res = await request(app).get(`/api/v1/stores${q ? `?q=${encodeURIComponent(q)}` : "?limit=60"}`);
  expect(res.status).toBe(200);
  return (res.body.stores as { slug: string }[]).map((s) => s.slug);
};

describe("the shop directory and the walkthrough videos' showcase store", () => {
  it("lists the named demo store", async () => {
    expect(await listed()).toContain(SHOWCASE);
  });

  it("never lists any other demo store", async () => {
    expect((await listed()).filter((s) => s.startsWith("demo-scout-") && s !== SHOWCASE)).toEqual([]);
  });

  it("finds it by search like any shop, and the search still leaves other demo stores out", async () => {
    expect(await listed(`showcase ${suffix}`)).toEqual([SHOWCASE]);
    expect(await listed(`other ${suffix}`)).toEqual([]);
  });
});
