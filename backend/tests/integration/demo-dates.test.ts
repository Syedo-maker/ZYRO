/**
 * A2 (2026-11): the demo stores' sales are moved up to yesterday so Product Scout's "last 7 days" never
 * goes empty. Uses its own throwaway demo store (and an ordinary one) through `onlyTenantIds`, so the
 * machine's own demo data is never touched.
 */
process.env.RATE_LIMIT_ENABLED = "false";

let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let refreshDemoSalesDates: typeof import("../../src/lib/demoDates").refreshDemoSalesDates;
let daysToShift: typeof import("../../src/lib/demoDates").daysToShift;

const DAY = 24 * 60 * 60 * 1000;
const suffix = Date.now().toString(36);
const now = new Date(Date.UTC(2026, 10, 6, 9, 30)); // 6 Nov 2026, 09:30 UTC
const ids = { users: [] as string[], tenants: [] as string[] };

async function store(slug: string, orderDaysAgo: number[]) {
  const owner = await prismaUnscoped.user.create({ data: { email: `verify-demo-dates-${slug}@example.com`, name: "Owner", passwordHash: "x" } });
  ids.users.push(owner.id);
  const tenant = await prismaUnscoped.tenant.create({ data: { name: `Verify ${slug}`, slug, ownerId: owner.id, currency: "PKR", listedInDirectory: false } });
  ids.tenants.push(tenant.id);
  for (const [i, daysAgo] of orderDaysAgo.entries()) {
    await prismaUnscoped.order.create({
      data: { tenantId: tenant.id, orderNumber: i + 1, channel: "ONLINE", status: "PAID", currency: "PKR", subtotal: "100.00", total: "100.00", createdAt: new Date(now.getTime() - daysAgo * DAY) },
    });
  }
  const location = await prismaUnscoped.location.create({ data: { tenantId: tenant.id, name: "Main" } });
  const shift = await prismaUnscoped.posShift.create({
    data: { tenantId: tenant.id, locationId: location.id, openedByUserId: owner.id, openingFloat: "0", openedAt: new Date(now.getTime() - orderDaysAgo[0] * DAY), closedAt: new Date(now.getTime() - orderDaysAgo[0] * DAY + 3600_000), status: "CLOSED" },
  });
  return { id: tenant.id, shiftId: shift.id };
}

const orderDates = async (tenantId: string) =>
  (await prismaUnscoped.order.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" }, select: { createdAt: true } })).map((o) => o.createdAt.getTime());

beforeAll(async () => {
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ refreshDemoSalesDates, daysToShift } = await import("../../src/lib/demoDates"));
});

afterAll(async () => {
  await prismaUnscoped.order.deleteMany({ where: { tenantId: { in: ids.tenants } } });
  await prismaUnscoped.posShift.deleteMany({ where: { tenantId: { in: ids.tenants } } });
  await prismaUnscoped.location.deleteMany({ where: { tenantId: { in: ids.tenants } } });
  await prismaUnscoped.tenant.deleteMany({ where: { id: { in: ids.tenants } } });
  await prismaUnscoped.user.deleteMany({ where: { id: { in: ids.users } } });
  await prismaUnscoped.$disconnect();
});

describe("how far to move", () => {
  it("lands the newest order on yesterday, by whole days", () => {
    expect(daysToShift(new Date(now.getTime() - 15 * DAY), now)).toBe(14);
    expect(daysToShift(new Date(now.getTime() - 1 * DAY), now)).toBe(0); // already yesterday
    expect(daysToShift(new Date(now.getTime() - 2 * 3600_000), now)).toBe(0); // today: never moved back
  });
});

describe("keeping the demo stores' sales recent", () => {
  it("moves an old demo store's sales so the newest is yesterday, keeping their spacing and time of day", async () => {
    const demo = await store(`demo-scout-verify-${suffix}`, [26, 20, 15]);
    const before = await orderDates(demo.id);
    const moved = await refreshDemoSalesDates(now, [demo.id]);
    expect(moved).toEqual([{ store: `demo-scout-verify-${suffix}`, days: 14 }]);
    const after = await orderDates(demo.id);
    expect(after.map((t, i) => t - before[i])).toEqual([14 * DAY, 14 * DAY, 14 * DAY]);
    expect(new Date(after[2]).toISOString().slice(0, 10)).toBe("2026-11-05"); // yesterday
    const shift = await prismaUnscoped.posShift.findUniqueOrThrow({ where: { id: demo.shiftId } });
    expect(shift.openedAt.getTime()).toBe(now.getTime() - 26 * DAY + 14 * DAY); // the register moved with the sales
  });

  it("running it again the same day changes nothing", async () => {
    const demo = ids.tenants[0];
    const before = await orderDates(demo);
    expect(await refreshDemoSalesDates(now, [demo])).toEqual([]);
    expect(await orderDates(demo)).toEqual(before);
  });

  it("never touches a store without the demo prefix", async () => {
    const real = await store(`verify-not-demo-${suffix}`, [30]);
    const before = await orderDates(real.id);
    expect(await refreshDemoSalesDates(now, [real.id])).toEqual([]);
    expect(await orderDates(real.id)).toEqual(before);
  });
});
