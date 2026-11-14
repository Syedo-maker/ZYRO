/**
 * Unsubscribing from a shop's cart reminders (modules/cart-recovery/unsubscribe.service.ts): a signed
 * link per shop and account, a page that needs a button press, the email app's one-click POST, a way
 * back, and no way to unsubscribe someone else.
 */
process.env.RATE_LIMIT_ENABLED = "false";

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let svc: typeof import("../../src/modules/cart-recovery/unsubscribe.service");

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };
let storeA: string;
let storeB: string;
let shopper: string;

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  svc = await import("../../src/modules/cart-recovery/unsubscribe.service");
  for (const tag of ["a", "b"]) {
    const reg = await request(app).post("/api/v1/auth/register").send({ email: `verify-unsub-${tag}-${suffix}@example.com`, password: "password123", storeName: `Unsub shop ${tag}`, storeSlug: `verify-unsub-${tag}-${suffix}` });
    const stores = await request(app).get("/api/v1/users/me/stores").set("Authorization", `Bearer ${reg.body.accessToken}`);
    created.tenantIds.push(stores.body[0].id);
    created.userIds.push(reg.body.user.id);
  }
  [storeA, storeB] = created.tenantIds;
  const c = await request(app).post("/api/v1/auth/register-customer").send({ email: `verify-unsub-shopper-${suffix}@example.com`, password: "password123" });
  shopper = c.body.user.id;
  created.userIds.push(shopper);
}, 60_000);

afterAll(async () => {
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await prismaUnscoped.$disconnect();
});

it("the links point at the web app and carry no email address", () => {
  const links = svc.unsubscribeLinks(storeA, shopper);
  expect(links.page).toMatch(/\/unsubscribe\?t=/);
  expect(links.oneClick).toMatch(/\/api\/v1\/unsubscribe\?t=/);
  expect(links.page).not.toMatch(/%40|@/);
});

it("opening the link only shows the page; the button unsubscribes; the same link turns it back on", async () => {
  const t = svc.unsubscribeToken(storeA, shopper);
  expect((await request(app).get(`/api/v1/unsubscribe?t=${t}`)).body).toEqual({ storeName: "Unsub shop a", unsubscribed: false });
  expect(await svc.unsubscribeService.isOptedOut(storeA, shopper)).toBe(false);

  const post = await request(app).post(`/api/v1/unsubscribe?t=${t}`).send({});
  expect(post.status).toBe(200);
  expect(post.body).toEqual({ storeName: "Unsub shop a", unsubscribed: true });
  expect(await svc.unsubscribeService.isOptedOut(storeA, shopper)).toBe(true);
  // Twice is the same as once.
  expect((await request(app).post(`/api/v1/unsubscribe?t=${t}`).type("form").send("List-Unsubscribe=One-Click")).status).toBe(200);
  expect(await prismaUnscoped.emailOptOut.count({ where: { tenantId: storeA, userId: shopper } })).toBe(1);
  expect((await request(app).get(`/api/v1/unsubscribe?t=${t}`)).body.unsubscribed).toBe(true);

  // Only for that shop.
  expect(await svc.unsubscribeService.isOptedOut(storeB, shopper)).toBe(false);

  expect((await request(app).delete(`/api/v1/unsubscribe?t=${t}`)).body).toEqual({ storeName: "Unsub shop a", unsubscribed: false });
  expect(await svc.unsubscribeService.isOptedOut(storeA, shopper)).toBe(false);
});

it("a forged, altered or malformed link is refused, and nothing changes", async () => {
  const good = svc.unsubscribeToken(storeA, shopper);
  const [s, u, sig] = good.split(".");
  const forged = [
    `${s}.${u}.${"A".repeat(32)}`, // a guessed signature
    `${storeB}.${u}.${sig}`, // another shop, same signature
    `${s}.${created.userIds[0]}.${sig}`, // another person, same signature
    `${s}.${u}`, // no signature
    "", // nothing
    `${s}.${u}.${sig}x`, // one character more
  ];
  for (const t of forged) {
    const res = await request(app).post(`/api/v1/unsubscribe?t=${encodeURIComponent(t)}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/not valid/);
  }
  expect(await prismaUnscoped.emailOptOut.count({ where: { userId: { in: created.userIds } } })).toBe(0);
});

it("a link for a deleted shop says so; a deleted account is simply nothing left to email", async () => {
  expect((await request(app).get(`/api/v1/unsubscribe?t=${svc.unsubscribeToken("cnotarealstore000000000", shopper)}`)).status).toBe(404);
  const gone = svc.unsubscribeToken(storeA, "cnotarealuser0000000000");
  expect((await request(app).post(`/api/v1/unsubscribe?t=${gone}`).send({})).body).toEqual({ storeName: "Unsub shop a", unsubscribed: true });
});

it("deleting the account removes its opt-outs with it", async () => {
  await request(app).post(`/api/v1/unsubscribe?t=${svc.unsubscribeToken(storeB, shopper)}`).send({});
  expect(await prismaUnscoped.emailOptOut.count({ where: { userId: shopper } })).toBe(1);
  await prismaUnscoped.user.delete({ where: { id: shopper } });
  expect(await prismaUnscoped.emailOptOut.count({ where: { userId: shopper } })).toBe(0);
});
