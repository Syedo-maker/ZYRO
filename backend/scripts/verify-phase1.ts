/**
 * End-to-end check of Phase 1 (authentication, multi-tenancy, staff, store, catalog,
 * image uploads) against the real local Postgres and MongoDB, through the real HTTP API.
 * Creates throwaway stores and users and removes them after.
 * Usage: npx tsx scripts/verify-phase1.ts
 */
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
}

async function main() {
  const { app } = await import("../src/app");
  const { connectMongo } = await import("../src/lib/mongo");
  const { prismaUnscoped } = await import("../src/lib/prisma");
  const { Product } = await import("../src/models/Product.model");
  const { closeRedis } = await import("../src/lib/redis");
  const mongoose = (await import("mongoose")).default;

  await connectMongo();
  const server = app.listen(0);
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const base = `${origin}/api/v1`;

  interface Res { status: number; json: any; headers: Headers; type: string }
  async function call(method: string, path: string, opts: { token?: string; body?: unknown; cookie?: string; form?: FormData } = {}): Promise<Res> {
    const headers: Record<string, string> = {};
    if (!opts.form) headers["Content-Type"] = "application/json";
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.cookie) headers.Cookie = opts.cookie;
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: res.status, json, headers: res.headers, type: res.headers.get("content-type") ?? "" };
  }
  const refreshCookie = (r: Res) => {
    const line = r.headers.getSetCookie().find((c) => c.startsWith("refreshToken="));
    return line ? { pair: line.split(";")[0], attrs: line.toLowerCase() } : null;
  };

  const suffix = Date.now().toString(36);
  const created = { userIds: [] as string[], tenantIds: [] as string[] };
  async function register(tag: string, password = "password123") {
    const email = `p1-${tag}-${suffix}@example.com`;
    const res = await call("POST", "/auth/register", { body: { email, password, storeName: `P1 ${tag}`, storeSlug: `p1-${tag}-${suffix}` } });
    const stores = await call("GET", "/users/me/stores", { token: res.json.accessToken });
    const storeId = stores.json[0].id as string;
    created.userIds.push(res.json.user.id);
    created.tenantIds.push(storeId);
    return { email, password, token: res.json.accessToken as string, userId: res.json.user.id as string, storeId, res };
  }

  try {
    // ================= Authentication =================
    const A = await register("a");
    const regRes = A.res;
    check("register: 201 with an access token and the user, no refresh token in the body", regRes.status === 201 && !!regRes.json.accessToken && regRes.json.user.email === A.email && !("refreshToken" in regRes.json));
    const cookie = refreshCookie(regRes)!;
    check("register: refresh token is an httpOnly cookie scoped to /api/v1/auth, SameSite=Lax", !!cookie && cookie.attrs.includes("httponly") && cookie.attrs.includes("path=/api/v1/auth") && cookie.attrs.includes("samesite=lax"));
    const jwtPayload = JSON.parse(Buffer.from(A.token.split(".")[1], "base64url").toString());
    check("register: access token carries only the user id (no tenant baked in)", jwtPayload.sub === A.userId && !("tenantId" in jwtPayload) && !("role" in jwtPayload));
    check("register: also created the owner's store with a default location", (await prismaUnscoped.location.count({ where: { tenantId: A.storeId, isDefault: true } })) === 1);

    check("register: duplicate email is 409", (await call("POST", "/auth/register", { body: { email: A.email, password: "password123", storeName: "X", storeSlug: `other-${suffix}` } })).status === 409);
    check("register: duplicate store slug is 409", (await call("POST", "/auth/register", { body: { email: `dup-${suffix}@example.com`, password: "password123", storeName: "X", storeSlug: `p1-a-${suffix}` } })).status === 409);
    check("register: short password is 400", (await call("POST", "/auth/register", { body: { email: `s-${suffix}@example.com`, password: "short", storeName: "X", storeSlug: `s-${suffix}` } })).status === 400);
    check("register: invalid slug is 400", (await call("POST", "/auth/register", { body: { email: `t-${suffix}@example.com`, password: "password123", storeName: "X", storeSlug: "Bad Slug!" } })).status === 400);
    check("register: invalid email is 400", (await call("POST", "/auth/register", { body: { email: "nope", password: "password123", storeName: "X", storeSlug: `u-${suffix}` } })).status === 400);
    check("register: a failed registration leaves no half-created user", (await prismaUnscoped.user.count({ where: { email: `dup-${suffix}@example.com` } })) === 0);

    const login = await call("POST", "/auth/login", { body: { email: A.email, password: A.password } });
    check("login: 200 with token and cookie", login.status === 200 && !!login.json.accessToken && !!refreshCookie(login));
    const wrongPw = await call("POST", "/auth/login", { body: { email: A.email, password: "wrong-password" } });
    const noUser = await call("POST", "/auth/login", { body: { email: `ghost-${suffix}@example.com`, password: "password123" } });
    check("login: wrong password and unknown email give the same 401 (no account enumeration)", wrongPw.status === 401 && noUser.status === 401 && wrongPw.json.title === noUser.json.title);
    check("errors: RFC 7807 problem+json with type, title, status", wrongPw.type.includes("application/problem+json") && !!wrongPw.json.type && wrongPw.json.status === 401);
    check("passwords are stored hashed, never in plain text", !(await prismaUnscoped.user.findUnique({ where: { id: A.userId } }))!.passwordHash.includes("password123"));

    // Refresh rotation
    const r1 = await call("POST", "/auth/refresh", { cookie: cookie.pair });
    const cookie2 = refreshCookie(r1);
    check("refresh: valid cookie gives a new access token and a rotated cookie", r1.status === 200 && !!r1.json.accessToken && !!cookie2 && cookie2.pair !== cookie.pair);
    check("refresh: replaying the old (rotated) token is 401", (await call("POST", "/auth/refresh", { cookie: cookie.pair })).status === 401);
    check("refresh: no cookie is 401", (await call("POST", "/auth/refresh")).status === 401);
    check("refresh: garbage cookie is 401", (await call("POST", "/auth/refresh", { cookie: "refreshToken=not-a-real-token" })).status === 401);
    const race = await Promise.all([call("POST", "/auth/refresh", { cookie: cookie2!.pair }), call("POST", "/auth/refresh", { cookie: cookie2!.pair })]);
    const raceCodes = race.map((r) => r.status).sort();
    check("refresh: two simultaneous refreshes of one token give one 200 and one clean 401, never a 500", raceCodes[0] === 200 && raceCodes[1] === 401, raceCodes.join("+"));
    const winner = refreshCookie(race.find((r) => r.status === 200)!)!;
    const lo = await call("POST", "/auth/logout", { cookie: winner.pair });
    check("logout: 204 and the cookie is cleared", lo.status === 204 && (lo.headers.getSetCookie().join(";").toLowerCase().includes("refreshtoken=;") || lo.headers.getSetCookie().join(";").includes("Expires=Thu, 01 Jan 1970")));
    check("logout: the refresh token is really revoked (refresh after logout is 401)", (await call("POST", "/auth/refresh", { cookie: winner.pair })).status === 401);
    check("logout: logging out twice is harmless", (await call("POST", "/auth/logout", { cookie: winner.pair })).status === 204);

    // Access tokens
    check("me: no token is 401", (await call("GET", "/users/me")).status === 401);
    check("me: malformed token is 401", (await call("GET", "/users/me", { token: "abc.def.ghi" })).status === 401);
    const me = await call("GET", "/users/me", { token: A.token });
    check("me: returns the caller's profile without the password hash", me.status === 200 && me.json.email === A.email && !("passwordHash" in me.json));
    const jwt = (await import("jsonwebtoken")).default;
    const { env } = await import("../src/config/env");
    const expired = jwt.sign({ sub: A.userId }, env.jwt.accessSecret, { expiresIn: -10 });
    check("me: an expired token is 401", (await call("GET", "/users/me", { token: expired })).status === 401);
    check("me: a token signed with the wrong secret is 401", (await call("GET", "/users/me", { token: jwt.sign({ sub: A.userId }, "some-other-secret") })).status === 401);

    // ================= Multi-tenancy & staff =================
    const B = await register("b");
    const S = await register("s");   // will become staff at A
    const S2 = await register("s2"); // will get no permissions on anything
    const meStores = await call("GET", "/users/me/stores", { token: A.token });
    check("stores: /users/me/stores lists only the caller's own store as owner", meStores.json.length === 1 && meStores.json[0].id === A.storeId && meStores.json[0].role === "owner");

    check("staff: no token is 401", (await call("POST", `/stores/${A.storeId}/staff`, { body: { email: S.email, permissions: ["products_write"] } })).status === 401);
    check("staff: another store's owner cannot add staff to my store (403)", (await call("POST", `/stores/${A.storeId}/staff`, { token: B.token, body: { email: S.email, permissions: ["products_write"] } })).status === 403);
    check("staff: unknown email is 404", (await call("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: `ghost-${suffix}@example.com`, permissions: ["products_write"] } })).status === 404);
    check("staff: empty permissions is 400", (await call("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: S.email, permissions: [] } })).status === 400);
    check("staff: uppercase permission names are rejected (contract is lowercase)", (await call("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: S.email, permissions: ["PRODUCTS_WRITE"] } })).status === 400);
    check("staff: an unknown permission is 400", (await call("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: S.email, permissions: ["do_anything"] } })).status === 400);
    check("staff: the owner cannot be added as staff of their own store (409)", (await call("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: A.email, permissions: ["products_write"] } })).status === 409);
    const addStaff = await call("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: S.email, permissions: ["products_write"] } });
    check("staff: owner adds staff (201), response follows the contract (email, lowercase permissions)", addStaff.status === 201 && addStaff.json.email === S.email && addStaff.json.permissions[0] === "products_write" && !!addStaff.json.id && !("tenantId" in addStaff.json));
    check("staff: adding the same person twice is 409", (await call("POST", `/stores/${A.storeId}/staff`, { token: A.token, body: { email: S.email, permissions: ["products_write"] } })).status === 409);
    check("staff: staff cannot add more staff (owner only)", (await call("POST", `/stores/${A.storeId}/staff`, { token: S.token, body: { email: S2.email, permissions: ["products_write"] } })).status === 403);
    const list = await call("GET", `/stores/${A.storeId}/staff`, { token: A.token });
    check("staff: owner lists staff with emails", list.status === 200 && list.json.length === 1 && list.json[0].email === S.email);
    check("staff: staff cannot list staff (403) and another owner cannot either (403)", (await call("GET", `/stores/${A.storeId}/staff`, { token: S.token })).status === 403 && (await call("GET", `/stores/${A.storeId}/staff`, { token: B.token })).status === 403);
    const sStores = await call("GET", "/users/me/stores", { token: S.token });
    check("stores: the staff member sees store A with role staff", sStores.json.some((s: any) => s.id === A.storeId && s.role === "staff"));

    // ================= Catalog =================
    const prod = { title: "Trail Mug", description: "Enamel mug", price: 12.5, stock: 7, category: "outdoors" };
    check("catalog: no token cannot create a product (401)", (await call("POST", `/stores/${A.storeId}/products`, { body: prod })).status === 401);
    check("catalog: a user with no role in the store cannot create (403)", (await call("POST", `/stores/${A.storeId}/products`, { token: S2.token, body: prod })).status === 403);
    check("catalog: another store's owner cannot create in my store (403)", (await call("POST", `/stores/${A.storeId}/products`, { token: B.token, body: prod })).status === 403);
    const c1 = await call("POST", `/stores/${A.storeId}/products`, { token: S.token, body: prod });
    check("catalog: staff with products_write can create (201), stock echoed, tenant set", c1.status === 201 && c1.json.stock === 7 && c1.json.storeId === A.storeId && c1.json.price === 12.5);
    check("catalog: negative price is 400", (await call("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { ...prod, price: -1 } })).status === 400);
    check("catalog: missing title is 400", (await call("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { price: 1, stock: 1, category: "x" } })).status === 400);
    check("catalog: fractional stock is 400", (await call("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { ...prod, stock: 1.5 } })).status === 400);
    const c2 = await call("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { title: "Camp Stove", description: "", price: 40, stock: 3, category: "gear" } });
    const pubList = await call("GET", `/stores/${A.storeId}/products`);
    check("catalog: public list needs no login and shows both products with stock", pubList.status === 200 && pubList.json.data.length === 2 && pubList.json.pagination.total === 2 && pubList.json.data.every((p: any) => typeof p.stock === "number"));
    check("catalog: category filter", (await call("GET", `/stores/${A.storeId}/products?category=gear`)).json.data.length === 1);
    check("catalog: text search", (await call("GET", `/stores/${A.storeId}/products?q=stove`)).json.data[0]?.title === "Camp Stove");
    check("catalog: pagination", (await call("GET", `/stores/${A.storeId}/products?limit=1&offset=1`)).json.data.length === 1);
    check("catalog: public get by id", (await call("GET", `/stores/${A.storeId}/products/${c1.json.id}`)).json.title === "Trail Mug");
    check("catalog: an unknown or malformed product id is 404", (await call("GET", `/stores/${A.storeId}/products/not-an-id`)).status === 404 && (await call("GET", `/stores/${A.storeId}/products/64b7f0f0f0f0f0f0f0f0f0f0`)).status === 404);
    const upd = await call("PUT", `/stores/${A.storeId}/products/${c1.json.id}`, { token: S.token, body: { ...prod, price: 15, stock: 9 } });
    check("catalog: update changes price and stock", upd.status === 200 && upd.json.price === 15 && upd.json.stock === 9);
    check("catalog: store B's data cannot reach A's product by id (404 inside B)", (await call("GET", `/stores/${B.storeId}/products/${c1.json.id}`)).status === 404 && (await call("PUT", `/stores/${B.storeId}/products/${c1.json.id}`, { token: B.token, body: prod })).status === 404 && (await call("DELETE", `/stores/${B.storeId}/products/${c1.json.id}`, { token: B.token })).status === 404);
    check("catalog: A's product is untouched after B's attempts", (await call("GET", `/stores/${A.storeId}/products/${c1.json.id}`)).json.price === 15);
    check("catalog: store B's public list does not include A's products", (await call("GET", `/stores/${B.storeId}/products`)).json.data.length === 0);

    // ================= Staff removal takes effect =================
    check("staff: another owner cannot remove my staff (403)", (await call("DELETE", `/stores/${A.storeId}/staff/${addStaff.json.id}`, { token: B.token })).status === 403);
    check("staff: an unknown staff id is 404", (await call("DELETE", `/stores/${A.storeId}/staff/nope`, { token: A.token })).status === 404);
    check("staff: owner removes staff (204)", (await call("DELETE", `/stores/${A.storeId}/staff/${addStaff.json.id}`, { token: A.token })).status === 204);
    check("staff: a removed staff member immediately loses access (403)", (await call("POST", `/stores/${A.storeId}/products`, { token: S.token, body: prod })).status === 403);
    check("staff: the list is empty again", (await call("GET", `/stores/${A.storeId}/staff`, { token: A.token })).json.length === 0);

    // ================= Store profile & branding =================
    const profile = await call("GET", `/stores/${A.storeId}`);
    check("store: public profile needs no login, exposes no owner details", profile.status === 200 && profile.json.name === "P1 a" && !("ownerId" in profile.json));
    check("store: unknown store is 404", (await call("GET", "/stores/nope")).status === 404);
    check("store: branding update by another owner is 403", (await call("PATCH", `/stores/${A.storeId}/branding`, { token: B.token, body: { name: "Hacked" } })).status === 403);
    check("store: branding rejects a bad color", (await call("PATCH", `/stores/${A.storeId}/branding`, { token: A.token, body: { themeColor: "red" } })).status === 400);
    const brand = await call("PATCH", `/stores/${A.storeId}/branding`, { token: A.token, body: { name: "Aurora Goods", themeColor: "#4F46E5" } });
    check("store: owner updates name and theme color", brand.status === 200 && brand.json.name === "Aurora Goods" && brand.json.themeColor === "#4F46E5");

    // ================= Image uploads =================
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const form = () => { const f = new FormData(); f.append("file", new Blob([png], { type: "image/png" }), "pixel.png"); return f; };
    check("upload: no token is 401", (await call("POST", `/stores/${A.storeId}/uploads/images`, { form: form() })).status === 401);
    check("upload: a user without products_write is 403", (await call("POST", `/stores/${A.storeId}/uploads/images`, { token: S2.token, form: form() })).status === 403);
    const up = await call("POST", `/stores/${A.storeId}/uploads/images`, { token: A.token, form: form() });
    check("upload: a PNG is accepted and a URL returned", up.status === 201 && typeof up.json.url === "string" && up.json.url.endsWith(".png"));
    const served = await fetch(up.json.url.startsWith("http") ? up.json.url : origin + up.json.url);
    check("upload: the returned URL actually serves the image", served.status === 200 && (served.headers.get("content-type") ?? "").includes("image/png"));
    const textForm = new FormData(); textForm.append("file", new Blob(["hello"], { type: "text/plain" }), "note.txt");
    check("upload: a non-image is rejected with 400, not a 500", (await call("POST", `/stores/${A.storeId}/uploads/images`, { token: A.token, form: textForm })).status === 400);
    const bigForm = new FormData(); bigForm.append("file", new Blob([Buffer.alloc(5 * 1024 * 1024 + 10)], { type: "image/png" }), "big.png");
    check("upload: a file over 5 MB is rejected with 400", (await call("POST", `/stores/${A.storeId}/uploads/images`, { token: A.token, form: bigForm })).status === 400);
    const noFile = await call("POST", `/stores/${A.storeId}/uploads/images`, { token: A.token, form: new FormData() });
    check("upload: a request with no file is a clean 4xx, not a crash", noFile.status >= 400 && noFile.status < 500, `status=${noFile.status}`);
    const withImg = await call("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { ...prod, title: "With image", images: [up.json.url] } });
    check("upload: a product stores the image URL, not the file", withImg.status === 201 && withImg.json.images[0] === up.json.url);
    check("catalog: a product cannot hold more than 10 images", (await call("POST", `/stores/${A.storeId}/products`, { token: A.token, body: { ...prod, images: Array.from({ length: 11 }, () => up.json.url) } })).status === 400);

    // ================= Delete & general routing =================
    check("catalog: owner deletes a product (204) and it is gone (404)", (await call("DELETE", `/stores/${A.storeId}/products/${c2.json.id}`, { token: A.token })).status === 204 && (await call("GET", `/stores/${A.storeId}/products/${c2.json.id}`)).status === 404);
    const nf = await call("GET", "/nothing/here");
    check("routing: an unknown route is a 404 problem+json", nf.status === 404 && nf.type.includes("problem+json"));
    const health = await fetch(`${origin}/health`);
    check("health endpoint answers", health.status === 200);
  } finally {
    await Product.deleteMany({ storeId: { $in: created.tenantIds } });
    for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
    for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
    server.close();
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  await closeRedis();
  await mongoose.disconnect();
  await prismaUnscoped.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
