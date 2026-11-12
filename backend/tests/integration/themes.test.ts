/**
 * Store Themes, end to end on real Postgres and Redis: the owner's draft, Publish, the last 10
 * versions with restore, Undo and Redo, and the walls around them. Only the owner reads or changes a
 * theme (not a Manager, not a shopper, not another store's owner), a shopper sees the published theme
 * and never the draft, and a theme can carry no CSS, no HTML and no image from anywhere but its store.
 */
process.env.RATE_LIMIT_ENABLED = "false";

import request from "supertest";
import type { Express } from "express";

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let publicUrl: (key: string) => string;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };
const uuid = "123e4567-e89b-12d3-a456-426614174000";

async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${path}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

async function owner(tag: string) {
  const email = `verify-theme-${tag}-${suffix}@example.com`;
  const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `Verify theme ${tag}`, storeSlug: `verify-theme-${tag}-${suffix}` } });
  if (reg.status !== 201) throw new Error(`register ${tag}: ${reg.status} ${JSON.stringify(reg.json)}`);
  const storeId = (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id as string;
  created.tenantIds.push(storeId);
  created.userIds.push(reg.json.user.id);
  return { token: reg.json.accessToken as string, storeId };
}

let A: Awaited<ReturnType<typeof owner>>;
let B: Awaited<ReturnType<typeof owner>>;
let managerToken: string;
let shopperToken: string;

const path = (s: { storeId: string }, rest = "") => `/stores/${s.storeId}/theme${rest}`;
const getDraft = async (s = A) => (await api("GET", path(s), { token: s.token })).json.draft;
const saveDraft = (theme: unknown, s = A) => api("PUT", path(s, "/draft"), { token: s.token, body: { theme } });

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  const { getStorage } = await import("../../src/lib/storage");
  publicUrl = (key) => getStorage().publicUrl(key);
  A = await owner("a");
  B = await owner("b");

  const mEmail = `verify-theme-m-${suffix}@example.com`;
  expect((await api("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: mEmail, password: "staff-pass-123", role: "manager" } })).status).toBe(201);
  const m = await api("POST", "/auth/login", { body: { email: mEmail, password: "staff-pass-123" } });
  managerToken = m.json.accessToken;
  created.userIds.push(m.json.user.id);

  const c = await api("POST", "/auth/register-customer", { body: { email: `verify-theme-c-${suffix}@example.com`, password: "password123" } });
  shopperToken = c.json.accessToken;
  created.userIds.push(c.json.user.id);
}, 60_000);

afterAll(async () => {
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/redis")).closeRedis();
  await prismaUnscoped.$disconnect();
});

describe("a store's theme before anything is published", () => {
  it("starts as Dark Lime, and the public profile has no theme yet (the storefront keeps its default look)", async () => {
    const state = await api("GET", path(A), { token: A.token });
    expect(state.status).toBe(200);
    expect(state.json.draft.preset).toBe("dark-lime");
    expect(state.json.published).toBeNull();
    expect(state.json).toMatchObject({ canUndo: false, canRedo: false, hasUnpublishedChanges: true });
    const profile = await api("GET", `/stores/${A.storeId}`);
    expect({ status: profile.status, theme: profile.json.theme, body: profile.status === 200 ? null : profile.json }).toEqual({ status: 200, theme: null, body: null });
  });

  it("offers the five presets and six font pairs", async () => {
    const options = (await api("GET", path(A, "/options"), { token: A.token })).json;
    expect(options.presets.map((p: { id: string }) => p.id)).toEqual(["dark-lime", "clean-light", "warm-earth", "soft-pastel", "bold-contrast"]);
    expect(options.fonts).toHaveLength(6);
  });
});

describe("draft and publish", () => {
  it("a saved draft is the owner's alone: the storefront shows only what was published", async () => {
    const options = (await api("GET", path(A, "/options"), { token: A.token })).json;
    const cleanLight = options.presets.find((p: { id: string }) => p.id === "clean-light").theme;
    expect((await saveDraft({ ...cleanLight, heroHeadline: "Draft headline" })).status).toBe(200);

    const pub = (await api("GET", `/stores/${A.storeId}`)).json;
    expect(pub.theme).toBeNull();
    expect(JSON.stringify(pub)).not.toContain("Draft headline");

    const published = await api("POST", path(A, "/publish"), { token: A.token });
    expect(published.status).toBe(200);
    expect(published.json.hasUnpublishedChanges).toBe(false);
    const live = (await api("GET", `/stores/${A.storeId}`)).json.theme;
    expect(live.theme.heroHeadline).toBe("Draft headline");
    expect(live.tokens["--color-bg"]).toBe("#ffffff");

    // A new draft does not leak: the live theme stays as published.
    await saveDraft({ ...(await getDraft()), heroHeadline: "Second draft" });
    const after = (await api("GET", `/stores/${A.storeId}`)).json;
    expect(after.theme.theme.heroHeadline).toBe("Draft headline");
    expect(JSON.stringify(after)).not.toContain("Second draft");
  });

  it("colours that fail AA are corrected on save, and the owner is told what changed", async () => {
    const draft = await getDraft();
    const res = await saveDraft({ ...draft, colors: { ...draft.colors, text: "#f4f4f4" } }); // near-white text on white
    expect(res.status).toBe(200);
    const fix = res.json.corrections.find((c: { field: string }) => c.field === "text");
    expect(fix.message).toMatch(/changed to #[0-9a-f]{6}/);
    expect(res.json.draft.colors.text).toBe(fix.to);
    for (const c of res.json.checks) expect(c.ratio).toBeGreaterThanOrEqual(c.min);
  });
});

describe("undo, redo and versions", () => {
  it("undo walks back one change, redo forward, and a new change drops what was undone", async () => {
    const draft = await getDraft();
    await saveDraft({ ...draft, heroText: "one" });
    await saveDraft({ ...draft, heroText: "two" });

    const undone = await api("POST", path(A, "/undo"), { token: A.token });
    expect(undone.json.draft.heroText).toBe("one");
    expect(undone.json.canRedo).toBe(true);
    const redone = await api("POST", path(A, "/redo"), { token: A.token });
    expect(redone.json.draft.heroText).toBe("two");
    expect((await api("POST", path(A, "/redo"), { token: A.token })).status).toBe(409);

    await api("POST", path(A, "/undo"), { token: A.token });
    const branched = await saveDraft({ ...draft, heroText: "three" });
    expect(branched.json.canRedo).toBe(false);
  });

  it("keeps the last 10 published versions, and restoring one loads it into the draft without publishing", async () => {
    const draft = await getDraft();
    for (let i = 1; i <= 12; i++) {
      await saveDraft({ ...draft, heroText: `version ${i}` });
      expect((await api("POST", path(A, "/publish"), { token: A.token })).status).toBe(200);
    }
    const { versions } = (await api("GET", path(A, "/versions"), { token: A.token })).json;
    expect(versions).toHaveLength(10);
    expect(versions[0].theme.heroText).toBe("version 12");
    expect(versions[9].theme.heroText).toBe("version 3");

    const restored = await api("POST", path(A, `/versions/${versions[4].id}/restore`), { token: A.token });
    expect(restored.status).toBe(200);
    expect(restored.json.draft.heroText).toBe("version 8");
    expect(restored.json.hasUnpublishedChanges).toBe(true);
    expect((await api("GET", `/stores/${A.storeId}`)).json.theme.theme.heroText).toBe("version 12");
  });
});

describe("what a theme can carry", () => {
  it.each([
    ["raw CSS in an extra key", (t: any) => ({ ...t, css: "body{display:none}" })],
    ["a colour with CSS in it", (t: any) => ({ ...t, colors: { ...t.colors, primary: "red;background:url(x)" } })],
    ["HTML in the about text", (t: any) => ({ ...t, aboutText: "<img src=x onerror=alert(1)>" })],
    ["a font outside the list", (t: any) => ({ ...t, font: "Comic Sans" })],
    ["a logo from another website", (t: any) => ({ ...t, logoUrl: "https://evil.example.com/logo.png" })],
    ["an SVG logo", (t: any) => ({ ...t, logoUrl: `http://localhost:5000/uploads/products/${A.storeId}/${uuid}.svg` })],
  ])("refuses %s", async (_label, change) => {
    const before = await getDraft();
    const res = await saveDraft(change(before));
    expect(res.status).toBe(400);
    expect(await getDraft()).toEqual(before);
  });

  it("accepts its own store's uploaded image, but not another store's", async () => {
    const draft = await getDraft();
    expect((await saveDraft({ ...draft, logoUrl: publicUrl(`products/${A.storeId}/${uuid}.png`) })).status).toBe(200);
    const res = await saveDraft({ ...draft, bannerUrl: publicUrl(`products/${B.storeId}/${uuid}.png`) });
    expect(res.status).toBe(400);
    expect(res.json.detail).toMatch(/uploaded to this store/);
  });
});

describe("who can reach a theme", () => {
  const routes = (s: { storeId: string }) =>
    [
      ["GET", path(s)],
      ["GET", path(s, "/options")],
      ["PUT", path(s, "/draft")],
      ["POST", path(s, "/undo")],
      ["POST", path(s, "/redo")],
      ["POST", path(s, "/publish")],
      ["GET", path(s, "/versions")],
      ["POST", path(s, "/versions/anything/restore")],
    ] as const;

  it("no one signed in: 401 on every route", async () => {
    for (const [m, p] of routes(A)) expect({ m, p, status: (await api(m, p, { body: m === "PUT" ? { theme: {} } : undefined })).status }).toEqual({ m, p, status: 401 });
  });

  it("a Manager of the same store, a shopper, and another store's owner: 403 on every route", async () => {
    for (const token of [managerToken, shopperToken, B.token]) {
      for (const [m, p] of routes(A)) {
        const res = await api(m, p, { token, body: m === "PUT" ? { theme: {} } : undefined });
        expect({ m, p, status: res.status }).toEqual({ m, p, status: 403 });
        expect(JSON.stringify(res.json)).not.toMatch(/draft|heroText/);
      }
    }
  });

  it("one owner's changes never touch another store's theme", async () => {
    const bBefore = (await api("GET", path(B), { token: B.token })).json;
    await saveDraft({ ...(await getDraft()), heroText: "only in A" });
    await api("POST", path(A, "/publish"), { token: A.token });
    const bAfter = (await api("GET", path(B), { token: B.token })).json;
    expect(bAfter.draft).toEqual(bBefore.draft);
    expect(bAfter.published).toBeNull();
    expect((await api("GET", path(B, "/versions"), { token: B.token })).json.versions).toEqual([]);

    // A version id from store A cannot be restored into store B.
    const aVersion = (await api("GET", path(A, "/versions"), { token: A.token })).json.versions[0].id;
    expect((await api("POST", path(B, `/versions/${aVersion}/restore`), { token: B.token })).status).toBe(404);
  });
});

describe("the storefront's reviews section", () => {
  it("shows only published 4 and 5 star written reviews from this store, with the product title, to anyone", async () => {
    await (await import("../../src/lib/mongo")).connectMongo();
    const { Product } = await import("../../src/models/Product.model");
    const { ProductReview } = await import("../../src/models/ProductReview.model");
    const make = async (s: { storeId: string; token: string }, title: string) =>
      (await api("POST", `/stores/${s.storeId}/products`, { token: s.token, body: { title, price: 10, stock: 5, category: "kitchen" } })).json.id as string;
    const pa = await make(A, "Clay mug");
    const pb = await make(B, "Other store mug");
    const review = (storeId: string, productId: string, n: string, rating: number, extra: Record<string, unknown> = {}) =>
      ProductReview.create({ storeId, productId, customerId: `cust-${n}-${suffix}`, authorName: `Buyer ${n}`, rating, comment: `comment ${n}`, ...extra });
    try {
      await review(A.storeId, pa, "good", 5);
      await review(A.storeId, pa, "low", 2);
      await review(A.storeId, pa, "hidden", 5, { status: "hidden" });
      await review(A.storeId, pa, "silent", 5, { comment: undefined });
      await review(B.storeId, pb, "otherstore", 5);

      const res = await api("GET", `/stores/${A.storeId}/reviews/featured`);
      expect(res.status).toBe(200);
      expect(res.json.data.map((r: { comment: string }) => r.comment)).toEqual(["comment good"]);
      expect(res.json.data[0].productTitle).toBe("Clay mug");
    } finally {
      await ProductReview.deleteMany({ storeId: { $in: [A.storeId, B.storeId] } });
      await Product.deleteMany({ storeId: { $in: [A.storeId, B.storeId] } });
      await (await import("mongoose")).default.disconnect();
    }
  });
});
