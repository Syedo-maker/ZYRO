/**
 * End-to-end check of product Search and Reviews (Phase 3, Module 1 remaining) against the real
 * local Postgres, MongoDB and Redis, driven through the real HTTP API: relevance-ranked text
 * search, the partial-word fallback, filters, sorting, pagination and suggestions; then reviews:
 * who may write one, verified purchases, ratings computed on read, editing and deleting your own,
 * merchant moderation and replies, cascade on product delete, and tenant isolation.
 * Creates throwaway stores and users and removes them after.
 * Run with: npm test -- search-reviews
 */
import { appFetch, APP_ORIGIN } from "../helpers/appFetch";
import { createCheckRecorder, snapshotEnv } from "../helpers/checks";

// Every environment variable this file sets is put back afterwards (see afterAll).
const restoreEnv = snapshotEnv();
const { check, run, declare } = createCheckRecorder();
function exitScenario(code: number): never {
  throw new Error(`The scenario stopped early (exit code ${code})`);
}

process.env.RATE_LIMIT_ENABLED = "false"; // many registrations in a row; verify-security.ts covers the limits

async function main() {
  const { app } = await import("../../src/app");
  const { connectMongo } = await import("../../src/lib/mongo");
  const { prismaUnscoped } = await import("../../src/lib/prisma");
  const { closeRedis } = await import("../../src/lib/redis");
  const { tenantContext } = await import("../../src/lib/tenantContext");
  const { createOrder } = await import("../../src/modules/commerce/order.service");
  const { displayName } = await import("../../src/modules/reviews/review.service");
  const { Product } = await import("../../src/models/Product.model");
  const { ProductReview } = await import("../../src/models/ProductReview.model");
  const mongoose = (await import("mongoose")).default;

  await connectMongo();
  const fetch = appFetch(app, [process.env.PUBLIC_URL ?? "http://localhost:5000"]);
  const base = `${APP_ORIGIN}/api/v1`;

  async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const res = await fetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }

  const suffix = Date.now().toString(36);
  const created = { tenantIds: [] as string[], userIds: [] as string[] };
  async function register(tag: string, name?: string) {
    const email = `verify-sr-${tag}-${suffix}@example.com`;
    const reg = await api("POST", "/auth/register", { body: { email, password: "password123", storeName: `Verify ${tag}`, storeSlug: `verify-sr-${tag}-${suffix}` } });
    const stores = await api("GET", "/users/me/stores", { token: reg.json.accessToken });
    const storeId = (Array.isArray(stores.json) ? stores.json : stores.json.data)[0].id as string;
    created.tenantIds.push(storeId);
    created.userIds.push(reg.json.user.id);
    if (name) await prismaUnscoped.user.update({ where: { id: reg.json.user.id }, data: { name } });
    return { token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string, email };
  }
  async function staffMember(owner: { token: string; storeId: string }, tag: string, permissions: string[]) {
    const email = `verify-sr-${tag}-${suffix}@example.com`;
    const made = await api("POST", `/stores/${owner.storeId}/staff`, { token: owner.token, body: { email, name: tag, password: "password123", permissions } });
    created.userIds.push(made.json.userId);
    return (await api("POST", "/auth/login", { body: { email, password: "password123" } })).json.accessToken as string;
  }

  try {
    const A = await register("a");
    const B = await register("b");
    const shopper1 = await register("s1", "Sam Okafor");
    const shopper2 = await register("s2", "Riley");
    const shopper3 = await register("s3");
    const cashier = await staffMember(A, "cashier", ["pos_sell"]);
    const catalogStaff = await staffMember(A, "catalog", ["products_write"]);

    // ---- The text index ----
    const indexes = await Product.collection.indexes();
    const textIndex = indexes.find((i) => (i as { weights?: unknown }).weights) as { name?: string; weights?: Record<string, number> } | undefined;
    check("index: the product text index weighs title 10, category 3, description 1 (run `npm run sync-indexes` if this fails)", textIndex?.name === "product_search" && textIndex.weights?.title === 10 && textIndex.weights?.category === 3 && textIndex.weights?.description === 1, JSON.stringify(textIndex?.weights));

    // ---- Catalog ----
    const mk = async (token: string, storeId: string, title: string, price: number, category: string, description: string, stock: number) =>
      (await api("POST", `/stores/${storeId}/products`, { token, body: { title, price, stock, category, description } })).json.id as string;
    const mug = await mk(A.token, A.storeId, "Ceramic Mug", 12.5, "kitchen", "Handmade ceramic mug for coffee", 10);
    const travel = await mk(A.token, A.storeId, "Travel Mug", 18, "kitchen", "Insulated steel travel mug", 0);
    const poster = await mk(A.token, A.storeId, "Mugshot Poster", 8, "art", "A poster of mugs", 5);
    const grinder = await mk(A.token, A.storeId, "Coffee Grinder", 45, "appliances", "Burr grinder for coffee beans, ceramic burrs", 3);
    const lamp = await mk(A.token, A.storeId, "Desk Lamp", 30, "lighting", "Bright LED lamp", 7);
    const notebook = await mk(A.token, A.storeId, "Notebook", 5, "stationery", "Ceramic-free paper notebook", 20);
    for (let i = 1; i <= 30; i++) await mk(A.token, A.storeId, `Filler Item ${String(i).padStart(2, "0")}`, i, "filler", "Just a filler product", 5);
    await mk(B.token, B.storeId, "Ceramic Teapot", 25, "kitchen", "Another store's ceramic teapot", 4);

    const S = (q: string, storeId = A.storeId) => api("GET", `/stores/${storeId}/products${q}`);
    const titles = (r: { json: { data: { title: string }[] } }) => r.json.data.map((p) => p.title);

    // ---- Text search ----
    const ceramic = await S("?q=ceramic");
    check("search: 'ceramic' finds the mug, the grinder and the notebook, with the title match first", ceramic.status === 200 && titles(ceramic)[0] === "Ceramic Mug" && new Set(titles(ceramic)).size === 3 && titles(ceramic).includes("Coffee Grinder") && titles(ceramic).includes("Notebook") && ceramic.json.pagination.total === 3, titles(ceramic).join(", "));
    const mugs = await S("?q=mug");
    check("search: 'mug' (also matching the plural in a description) ranks title matches above the description-only poster", titles(mugs).slice(0, 2).sort().join() === "Ceramic Mug,Travel Mug" && titles(mugs)[2] === "Mugshot Poster" && titles(mugs).length === 3, titles(mugs).join(", "));
    check("search: the category is searched too ('kitchen' finds both mugs)", titles(await S("?q=kitchen")).sort().join() === "Ceramic Mug,Travel Mug");
    check("search: case does not matter", titles(await S("?q=CERAMIC")).length === 3);
    const partial = await S("?q=cer");
    check("search: a partial word ('cer') falls back to a contains match and finds 'Ceramic Mug'", titles(partial).join() === "Ceramic Mug" && partial.json.pagination.total === 1, titles(partial).join(", "));
    check("search: a partial word matches inside a title too ('rinde' finds 'Coffee Grinder')", titles(await S("?q=rinde")).join() === "Coffee Grinder");
    const weird = await S("?q=" + encodeURIComponent("(.*["));
    check("search: regex characters are plain text, never a pattern (200, no results)", weird.status === 200 && weird.json.pagination.total === 0);
    check("search: no match is an empty page, not an error", (await S("?q=zzzzqqq")).json.data.length === 0);
    check("search: an empty search box is the same as browsing", (await S("?q=")).json.pagination.total === 36 && (await S("?q=%20%20")).status === 200);
    check("search: an over-long query is 400", (await S("?q=" + "x".repeat(101))).status === 400);
    check("search: only this store's products are found (the other store's teapot never appears)", !titles(await S("?q=ceramic")).includes("Ceramic Teapot") && titles(await S("?q=ceramic", B.storeId)).join() === "Ceramic Teapot");

    // ---- Sorting ----
    const cat = (extra: string) => S(`?category=kitchen${extra}`);
    check("sort: price low to high and high to low", titles(await cat("&sort=price_asc")).join() === "Ceramic Mug,Travel Mug" && titles(await cat("&sort=price_desc")).join() === "Travel Mug,Ceramic Mug");
    const alpha = titles(await S("?category=filler&sort=title&limit=100"));
    check("sort: by title, alphabetical", alpha.length === 30 && alpha.join() === [...alpha].sort((a, b) => a.localeCompare(b)).join());
    const newest = titles(await S("?sort=newest&limit=3"));
    check("sort: newest first is the default (the last product added comes first)", newest[0] === "Filler Item 30" && titles(await S("?limit=3")).join() === newest.join());
    check("sort: 'relevance' with no search means newest", titles(await S("?sort=relevance&limit=1"))[0] === "Filler Item 30");
    check("sort: an unknown sort is 400", (await S("?sort=cheapest")).status === 400);
    check("sort: prices sort as numbers, not text (9 before 10)", titles(await S("?category=filler&sort=price_asc&limit=10")).slice(8).join() === "Filler Item 09,Filler Item 10");

    // ---- Filters ----
    check("filter: by category", (await cat("")).json.pagination.total === 2 && (await S("?category=art")).json.data[0].title === "Mugshot Poster");
    check("filter: price range is inclusive at both ends", titles(await S("?category=kitchen&minPrice=12.5&maxPrice=18&sort=price_asc")).join() === "Ceramic Mug,Travel Mug" && titles(await S("?category=kitchen&minPrice=12.51")).join() === "Travel Mug" && titles(await S("?category=kitchen&maxPrice=12.49")).length === 0);
    check("filter: only a minimum, or only a maximum", (await S("?minPrice=40")).json.data.map((p: { title: string }) => p.title).join() === "Coffee Grinder" && (await S("?maxPrice=5&category=stationery")).json.pagination.total === 1);
    check("filter: a minimum above the maximum, or a bad price, is 400", (await S("?minPrice=20&maxPrice=10")).status === 400 && (await S("?minPrice=abc")).status === 400 && (await S("?minPrice=-1")).status === 400);
    const inStock = await cat("&inStock=true");
    check("filter: in stock only leaves out the sold-out travel mug", titles(inStock).join() === "Ceramic Mug" && (await cat("&inStock=false")).json.pagination.total === 2);
    check("filter: filters and search combine (mugs, in stock, under 15: only the Ceramic Mug and poster qualify by stock)", titles(await S("?q=mug&inStock=true&maxPrice=15")).sort().join() === "Ceramic Mug,Mugshot Poster");
    check("filter: every product in the answer has stock information", (await S("?inStock=true&limit=100")).json.data.every((p: { stock: number }) => p.stock > 0));

    // ---- Pagination ----
    const pages = [];
    for (const off of [0, 10, 20]) pages.push(titles(await S(`?category=filler&sort=title&limit=10&offset=${off}`)));
    check("pagination: three pages of 10 cover all 30 products with no repeats", pages.every((p) => p.length === 10) && new Set(pages.flat()).size === 30);
    check("pagination: total is reported, and a page past the end is empty", (await S("?category=filler&limit=10&offset=20")).json.pagination.total === 30 && (await S("?category=filler&offset=100")).json.data.length === 0);
    check("pagination: a limit over 100 or a negative offset is 400", (await S("?limit=101")).status === 400 && (await S("?offset=-1")).status === 400);

    // ---- Suggestions ----
    const sug = await api("GET", `/stores/${A.storeId}/products/suggest?q=mu`);
    check("suggest: words that start with what was typed, sorted, with id and category", sug.status === 200 && sug.json.map((s: { title: string }) => s.title).join() === "Ceramic Mug,Mugshot Poster,Travel Mug" && !!sug.json[0].id && sug.json[0].category === "kitchen");
    check("suggest: at most 8", (await api("GET", `/stores/${A.storeId}/products/suggest?q=fil`)).json.length === 8);
    check("suggest: matches the start of any word (gr finds 'Coffee Grinder'), ignoring case", (await api("GET", `/stores/${A.storeId}/products/suggest?q=GR`)).json[0].title === "Coffee Grinder");
    check("suggest: a partial word in the middle does not match ('rinder' finds nothing)", (await api("GET", `/stores/${A.storeId}/products/suggest?q=rinder`)).json.length === 0);
    check("suggest: an empty or missing query is 400, and regex characters are plain text", (await api("GET", `/stores/${A.storeId}/products/suggest?q=`)).status === 400 && (await api("GET", `/stores/${A.storeId}/products/suggest`)).status === 400 && (await api("GET", `/stores/${A.storeId}/products/suggest?q=${encodeURIComponent("(.*")}`)).json.length === 0);
    check("suggest: only this store's products", (await api("GET", `/stores/${B.storeId}/products/suggest?q=mu`)).json.length === 0 && (await api("GET", `/stores/${B.storeId}/products/suggest?q=ce`)).json[0].title === "Ceramic Teapot");
    check("suggest: needs no sign-in, and the route is not mistaken for a product id", (await api("GET", `/stores/${A.storeId}/products/suggest?q=no`)).status === 200);

    // ---- Reviews: who may write one ----
    const R = (productId: string, storeId = A.storeId) => `/stores/${storeId}/products/${productId}/reviews`;
    const customer1 = await prismaUnscoped.customer.create({ data: { tenantId: A.storeId, userId: shopper1.userId, email: shopper1.email, name: "Sam" } });
    const customer3 = await prismaUnscoped.customer.create({ data: { tenantId: A.storeId, userId: shopper3.userId, email: shopper3.email, name: "S3" } });
    const buy = (customerId: string, n: number) =>
      tenantContext.run(A.storeId, () => createOrder({ tenantId: A.storeId, channel: "ONLINE", customerId, items: [{ productId: mug, quantity: 1 }], payments: [{ method: "STRIPE", amount: 12.5, stripePaymentIntentId: `pi_sr_${suffix}_${n}` }] }));
    await buy(customer1.id, 1);
    const refundedOrder = await buy(customer3.id, 2);
    await prismaUnscoped.order.update({ where: { id: refundedOrder.id }, data: { status: "REFUNDED" } });

    const noToken = await api("POST", R(mug), { body: { rating: 5 } });
    check("reviews: writing one needs a signed-in account (401)", noToken.status === 401);
    check("reviews: the store's owner cannot review its own product (403)", (await api("POST", R(mug), { token: A.token, body: { rating: 5 } })).status === 403);
    check("reviews: nor can its staff, whatever their role (403)", (await api("POST", R(mug), { token: cashier, body: { rating: 5 } })).status === 403 && (await api("POST", R(mug), { token: catalogStaff, body: { rating: 5 } })).status === 403);
    check("reviews: an unknown or malformed product id is 404", (await api("POST", R("64b7f0f0f0f0f0f0f0f0f0f0"), { token: shopper1.token, body: { rating: 5 } })).status === 404 && (await api("POST", R("nope"), { token: shopper1.token, body: { rating: 5 } })).status === 404 && (await api("GET", R("nope"))).status === 404);
    const bad = async (body: unknown) => (await api("POST", R(mug), { token: shopper2.token, body })).status;
    check("reviews: a rating must be a whole number from 1 to 5", (await bad({ rating: 0 })) === 400 && (await bad({ rating: 6 })) === 400 && (await bad({ rating: 2.5 })) === 400 && (await bad({ rating: "5" })) === 400 && (await bad({})) === 400);
    check("reviews: over-long title (100) or comment (2000) is 400", (await bad({ rating: 4, title: "t".repeat(101) })) === 400 && (await bad({ rating: 4, comment: "c".repeat(2001) })) === 400);
    check("reviews: nothing was saved by the rejected attempts", (await ProductReview.countDocuments({ storeId: A.storeId })) === 0);

    // ---- Writing reviews ----
    const r1 = await api("POST", R(mug), { token: shopper1.token, body: { rating: 5, title: "  Lovely  ", comment: "Keeps coffee hot.\u0000 Great <b>mug</b>." } });
    check("reviews: a buyer's review is created (201) and marked as a verified purchase", r1.status === 201 && r1.json.verifiedPurchase === true && r1.json.rating === 5 && r1.json.status === "published");
    check("reviews: the reviewer is shown as 'Sam O.', never by id or email", r1.json.authorName === "Sam O." && !("customerId" in r1.json) && !JSON.stringify(r1.json).includes(shopper1.email) && !JSON.stringify(r1.json).includes(shopper1.userId));
    check("reviews: text is trimmed and control characters removed; markup is kept as plain text for the page to escape", r1.json.title === "Lovely" && r1.json.comment === "Keeps coffee hot. Great <b>mug</b>.");
    check("reviews: a second review of the same product by the same person is 409", (await api("POST", R(mug), { token: shopper1.token, body: { rating: 1 } })).status === 409);
    const r2 = await api("POST", R(mug), { token: shopper2.token, body: { rating: 3, comment: "Okay." } });
    check("reviews: someone who never bought it can review, but without the verified badge; a single name is shown as is", r2.status === 201 && r2.json.verifiedPurchase === false && r2.json.authorName === "Riley");
    const r3 = await api("POST", R(mug), { token: shopper3.token, body: { rating: 4 } });
    check("reviews: an order that was refunded does not count as a purchase; no name means 'Customer'", r3.status === 201 && r3.json.verifiedPurchase === false && r3.json.authorName === "Customer");
    check("reviews: a rating-only review (no text) is fine", r3.json.comment === null && r3.json.title === null);
    check("names: display name rules", displayName("Sam Okafor") === "Sam O." && displayName("  ana maria  lopez ") === "ana L." && displayName("Riley") === "Riley" && displayName("") === "Customer" && displayName(null) === "Customer");

    // ---- Reading reviews and the rating ----
    const list = await api("GET", R(mug));
    check("read: anyone can read the reviews (no sign-in): 3 reviews, average 4.00", list.status === 200 && list.json.pagination.total === 3 && list.json.averageRating === 4 && list.json.reviewCount === 3);
    check("read: the star breakdown", JSON.stringify(list.json.distribution) === JSON.stringify({ "1": 0, "2": 0, "3": 1, "4": 1, "5": 1 }));
    check("read: no reviewer id, email or status in the public list", list.json.data.every((r: Record<string, unknown>) => !("customerId" in r) && !("status" in r)) && !JSON.stringify(list.json).includes("@example.com"));
    check("read: a visitor who is not signed in gets no 'my review'", list.json.myReview === null);
    const mine = await api("GET", R(mug), { token: shopper2.token });
    check("read: a signed-in reviewer gets their own review back", mine.json.myReview?.rating === 3 && mine.json.myReview.status === "published" && (await api("GET", R(mug), { token: "garbage" })).status === 200);
    check("read: sort highest, lowest, newest, oldest", (await api("GET", R(mug) + "?sort=highest")).json.data[0].rating === 5 && (await api("GET", R(mug) + "?sort=lowest")).json.data[0].rating === 3 && (await api("GET", R(mug) + "?sort=newest")).json.data[0].rating === 4 && (await api("GET", R(mug) + "?sort=oldest")).json.data[0].rating === 5);
    const only5 = await api("GET", R(mug) + "?rating=5");
    check("read: filter by stars, and the summary still describes all reviews", only5.json.data.length === 1 && only5.json.pagination.total === 1 && only5.json.reviewCount === 3);
    check("read: paging", (await api("GET", R(mug) + "?limit=2&offset=2")).json.data.length === 1 && (await api("GET", R(mug) + "?limit=51")).status === 400 && (await api("GET", R(mug) + "?rating=6")).status === 400);
    check("read: a product with no reviews has no average (null) and a count of 0", (await api("GET", R(travel))).json.averageRating === null && (await api("GET", R(travel))).json.reviewCount === 0);
    const prod = await api("GET", `/stores/${A.storeId}/products/${mug}`);
    check("catalog: the product carries its average rating and review count, computed on read", prod.json.averageRating === 4 && prod.json.reviewCount === 3);
    const cards = (await S("?category=kitchen&sort=price_asc")).json.data;
    check("catalog: so does every card in a list (mug 4.0 / 3, travel mug none)", cards[0].averageRating === 4 && cards[0].reviewCount === 3 && cards[1].averageRating === null && cards[1].reviewCount === 0);

    // ---- Editing and deleting your own ----
    check("own: no body changes is 400, and someone with no review gets 404", (await api("PUT", R(mug) + "/mine", { token: shopper2.token, body: {} })).status === 400 && (await api("PUT", R(mug) + "/mine", { token: shopper2.token, body: { rating: 5 } })).status === 200 && (await api("PUT", R(travel) + "/mine", { token: shopper2.token, body: { rating: 5 } })).status === 404);
    const edited = await api("PUT", R(mug) + "/mine", { token: shopper2.token, body: { comment: "Better after a week." } });
    check("own: editing keeps the rating and the unverified badge and changes only what was sent", edited.json.rating === 5 && edited.json.comment === "Better after a week." && edited.json.verifiedPurchase === false);
    check("own: the average follows the edit ((5 + 5 + 4) / 3 = 4.67)", (await api("GET", R(mug))).json.averageRating === 4.67);
    check("own: nobody can edit or delete someone else's review (the URL only ever reaches your own)", (await api("PUT", R(mug) + "/mine", { token: shopper1.token, body: { rating: 1 } })).json.rating === 1 && (await ProductReview.findOne({ storeId: A.storeId, customerId: shopper2.userId }))!.rating === 5);
    await api("PUT", R(mug) + "/mine", { token: shopper1.token, body: { rating: 5 } });
    check("own: deleting your review (204) removes it from the list and the average", (await api("DELETE", R(mug) + "/mine", { token: shopper3.token })).status === 204 && (await api("GET", R(mug))).json.reviewCount === 2 && (await api("GET", R(mug))).json.averageRating === 5);
    check("own: deleting again is 404, and you can then write a new review", (await api("DELETE", R(mug) + "/mine", { token: shopper3.token })).status === 404 && (await api("POST", R(mug), { token: shopper3.token, body: { rating: 4, comment: "Second try" } })).status === 201);

    // ---- Merchant moderation ----
    const M = (q = "", token = A.token, storeId = A.storeId) => api("GET", `/stores/${storeId}/reviews${q}`, { token });
    const all = await M();
    check("merchant: the owner sees every review with the product title and the reviewer's status", all.status === 200 && all.json.pagination.total === 3 && all.json.data[0].productTitle === "Ceramic Mug" && all.json.data.every((r: { status: string }) => r.status === "published"));
    check("merchant: needs products_write: a cashier is 403, catalog staff and the owner are fine, another store's owner is 403, no token is 401", (await M("", cashier)).status === 403 && (await M("", catalogStaff)).status === 200 && (await M("", B.token)).status === 403 && (await api("GET", `/stores/${A.storeId}/reviews`)).status === 401);
    const reviewOf = (uid: string) => ProductReview.findOne({ storeId: A.storeId, customerId: uid }).then((r) => r!._id.toString());
    const id2 = await reviewOf(shopper2.userId);
    const id1 = await reviewOf(shopper1.userId);
    const hide = await api("PATCH", `/stores/${A.storeId}/reviews/${id2}`, { token: catalogStaff, body: { status: "hidden" } });
    check("moderate: staff with products_write hide a review", hide.status === 200 && hide.json.status === "hidden" && hide.json.productTitle === "Ceramic Mug");
    const afterHide = await api("GET", R(mug));
    check("moderate: a hidden review disappears from the page and from the count and average", afterHide.json.reviewCount === 2 && afterHide.json.averageRating === 4.5 && afterHide.json.data.every((r: { id: string }) => r.id !== id2), `avg=${afterHide.json.averageRating}`);
    check("moderate: the product's rating follows (catalog cards too)", (await api("GET", `/stores/${A.storeId}/products/${mug}`)).json.averageRating === 4.5 && (await S("?q=ceramic")).json.data.find((p: { title: string }) => p.title === "Ceramic Mug").reviewCount === 2);
    const hiddenOwn = await api("GET", R(mug), { token: shopper2.token });
    check("moderate: the reviewer still sees their own review, marked hidden, and cannot post another", hiddenOwn.json.myReview?.status === "hidden" && (await api("POST", R(mug), { token: shopper2.token, body: { rating: 1 } })).status === 409);
    check("moderate: the merchant can filter to hidden reviews", (await M("?status=hidden")).json.data.length === 1 && (await M("?status=published")).json.data.length === 2 && (await M(`?productId=${mug}`)).json.pagination.total === 3 && (await M("?rating=4")).json.data.length === 1);
    check("moderate: the reviewer editing a hidden review does not bring it back", (await api("PUT", R(mug) + "/mine", { token: shopper2.token, body: { comment: "Trying again" } })).json.status === "hidden");
    check("moderate: showing it again restores it", (await api("PATCH", `/stores/${A.storeId}/reviews/${id2}`, { token: A.token, body: { status: "published" } })).json.status === "published" && (await api("GET", R(mug))).json.reviewCount === 3);
    const reply = await api("PATCH", `/stores/${A.storeId}/reviews/${id1}`, { token: A.token, body: { reply: "  Thank you, Sam!  " } });
    check("reply: the store can reply publicly, with the time", reply.json.merchantReply === "Thank you, Sam!" && !!reply.json.merchantRepliedAt);
    const seen = (await api("GET", R(mug))).json.data.find((r: { id: string }) => r.id === id1);
    check("reply: shoppers see the reply, and the reviewer's own words are untouched", seen.merchantReply === "Thank you, Sam!" && seen.comment === "Keeps coffee hot. Great <b>mug</b>." && seen.rating === 5);
    check("reply: removing it (null) clears it and the time", (await api("PATCH", `/stores/${A.storeId}/reviews/${id1}`, { token: A.token, body: { reply: null } })).json.merchantReply === null);
    check("moderate: an empty change, a bad status and a too-long reply are 400", (await api("PATCH", `/stores/${A.storeId}/reviews/${id1}`, { token: A.token, body: {} })).status === 400 && (await api("PATCH", `/stores/${A.storeId}/reviews/${id1}`, { token: A.token, body: { status: "deleted" } })).status === 400 && (await api("PATCH", `/stores/${A.storeId}/reviews/${id1}`, { token: A.token, body: { reply: "r".repeat(1001) } })).status === 400);
    check("moderate: an unknown review is 404; another store's owner cannot touch it (403, and via their own path 404)", (await api("PATCH", `/stores/${A.storeId}/reviews/64b7f0f0f0f0f0f0f0f0f0f0`, { token: A.token, body: { status: "hidden" } })).status === 404 && (await api("PATCH", `/stores/${A.storeId}/reviews/${id1}`, { token: B.token, body: { status: "hidden" } })).status === 403 && (await api("PATCH", `/stores/${B.storeId}/reviews/${id1}`, { token: B.token, body: { status: "hidden" } })).status === 404 && (await ProductReview.findOne({ _id: id1, storeId: A.storeId }))!.status === "published");

    // ---- Isolation and cleanup ----
    check("isolation: another store's shopper page shows none of these reviews, and its merchant list is empty", (await api("GET", R(mug, B.storeId))).status === 404 && (await M("", B.token, B.storeId)).json.pagination.total === 0);
    check("isolation: reviewing another store's product through your own store's path is 404", (await api("POST", R(mug, B.storeId), { token: shopper1.token, body: { rating: 1 } })).status === 404 && (await ProductReview.countDocuments({ storeId: B.storeId })) === 0);
    check("database: two reviews by one person for one product cannot exist even by direct insert", await ProductReview.create({ storeId: A.storeId, productId: mug, customerId: shopper1.userId, authorName: "x", rating: 3 }).then(() => false, () => true));
    check("database: a rating of 6 or 2.5 cannot be stored", await ProductReview.create({ storeId: A.storeId, productId: mug, customerId: "other1", authorName: "x", rating: 6 }).then(() => false, () => true) && await ProductReview.create({ storeId: A.storeId, productId: mug, customerId: "other2", authorName: "x", rating: 2.5 }).then(() => false, () => true));
    const beforeDelete = await ProductReview.countDocuments({ storeId: A.storeId, productId: mug });
    check("cascade: deleting a product deletes its reviews", beforeDelete === 3 && (await api("DELETE", `/stores/${A.storeId}/products/${mug}`, { token: A.token })).status === 204 && (await ProductReview.countDocuments({ storeId: A.storeId, productId: mug })) === 0 && (await api("GET", R(mug))).status === 404);
    void poster; void grinder; void lamp; void notebook;
  } finally {
    await Product.deleteMany({ storeId: { $in: created.tenantIds } });
    await ProductReview.deleteMany({ storeId: { $in: created.tenantIds } });
    for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
    for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  }
  await closeRedis();
  await mongoose.disconnect();
  await prismaUnscoped.$disconnect();
}


beforeAll(() => run(main), 900_000);
afterAll(() => restoreEnv());

declare([
  "index: the product text index weighs title 10, category 3, description 1 (run `npm run sync-indexes` if this fails)",
  "search: 'ceramic' finds the mug, the grinder and the notebook, with the title match first",
  "search: 'mug' (also matching the plural in a description) ranks title matches above the description-only poster",
  "search: the category is searched too ('kitchen' finds both mugs)",
  "search: case does not matter",
  "search: a partial word ('cer') falls back to a contains match and finds 'Ceramic Mug'",
  "search: a partial word matches inside a title too ('rinde' finds 'Coffee Grinder')",
  "search: regex characters are plain text, never a pattern (200, no results)",
  "search: no match is an empty page, not an error",
  "search: an empty search box is the same as browsing",
  "search: an over-long query is 400",
  "search: only this store's products are found (the other store's teapot never appears)",
  "sort: price low to high and high to low",
  "sort: by title, alphabetical",
  "sort: newest first is the default (the last product added comes first)",
  "sort: 'relevance' with no search means newest",
  "sort: an unknown sort is 400",
  "sort: prices sort as numbers, not text (9 before 10)",
  "filter: by category",
  "filter: price range is inclusive at both ends",
  "filter: only a minimum, or only a maximum",
  "filter: a minimum above the maximum, or a bad price, is 400",
  "filter: in stock only leaves out the sold-out travel mug",
  "filter: filters and search combine (mugs, in stock, under 15: only the Ceramic Mug and poster qualify by stock)",
  "filter: every product in the answer has stock information",
  "pagination: three pages of 10 cover all 30 products with no repeats",
  "pagination: total is reported, and a page past the end is empty",
  "pagination: a limit over 100 or a negative offset is 400",
  "suggest: words that start with what was typed, sorted, with id and category",
  "suggest: at most 8",
  "suggest: matches the start of any word (gr finds 'Coffee Grinder'), ignoring case",
  "suggest: a partial word in the middle does not match ('rinder' finds nothing)",
  "suggest: an empty or missing query is 400, and regex characters are plain text",
  "suggest: only this store's products",
  "suggest: needs no sign-in, and the route is not mistaken for a product id",
  "reviews: writing one needs a signed-in account (401)",
  "reviews: the store's owner cannot review its own product (403)",
  "reviews: nor can its staff, whatever their role (403)",
  "reviews: an unknown or malformed product id is 404",
  "reviews: a rating must be a whole number from 1 to 5",
  "reviews: over-long title (100) or comment (2000) is 400",
  "reviews: nothing was saved by the rejected attempts",
  "reviews: a buyer's review is created (201) and marked as a verified purchase",
  "reviews: the reviewer is shown as 'Sam O.', never by id or email",
  "reviews: text is trimmed and control characters removed; markup is kept as plain text for the page to escape",
  "reviews: a second review of the same product by the same person is 409",
  "reviews: someone who never bought it can review, but without the verified badge; a single name is shown as is",
  "reviews: an order that was refunded does not count as a purchase; no name means 'Customer'",
  "reviews: a rating-only review (no text) is fine",
  "names: display name rules",
  "read: anyone can read the reviews (no sign-in): 3 reviews, average 4.00",
  "read: the star breakdown",
  "read: no reviewer id, email or status in the public list",
  "read: a visitor who is not signed in gets no 'my review'",
  "read: a signed-in reviewer gets their own review back",
  "read: sort highest, lowest, newest, oldest",
  "read: filter by stars, and the summary still describes all reviews",
  "read: paging",
  "read: a product with no reviews has no average (null) and a count of 0",
  "catalog: the product carries its average rating and review count, computed on read",
  "catalog: so does every card in a list (mug 4.0 / 3, travel mug none)",
  "own: no body changes is 400, and someone with no review gets 404",
  "own: editing keeps the rating and the unverified badge and changes only what was sent",
  "own: the average follows the edit ((5 + 5 + 4) / 3 = 4.67)",
  "own: nobody can edit or delete someone else's review (the URL only ever reaches your own)",
  "own: deleting your review (204) removes it from the list and the average",
  "own: deleting again is 404, and you can then write a new review",
  "merchant: the owner sees every review with the product title and the reviewer's status",
  "merchant: needs products_write: a cashier is 403, catalog staff and the owner are fine, another store's owner is 403, no token is 401",
  "moderate: staff with products_write hide a review",
  "moderate: a hidden review disappears from the page and from the count and average",
  "moderate: the product's rating follows (catalog cards too)",
  "moderate: the reviewer still sees their own review, marked hidden, and cannot post another",
  "moderate: the merchant can filter to hidden reviews",
  "moderate: the reviewer editing a hidden review does not bring it back",
  "moderate: showing it again restores it",
  "reply: the store can reply publicly, with the time",
  "reply: shoppers see the reply, and the reviewer's own words are untouched",
  "reply: removing it (null) clears it and the time",
  "moderate: an empty change, a bad status and a too-long reply are 400",
  "moderate: an unknown review is 404; another store's owner cannot touch it (403, and via their own path 404)",
  "isolation: another store's shopper page shows none of these reviews, and its merchant list is empty",
  "isolation: reviewing another store's product through your own store's path is 404",
  "database: two reviews by one person for one product cannot exist even by direct insert",
  "database: a rating of 6 or 2.5 cannot be stored",
  "cascade: deleting a product deletes its reviews",
]);
