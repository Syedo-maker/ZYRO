/**
 * The demo store the walkthrough videos are filmed in (scripts/demo-videos), on a development machine only.
 *
 *   npx tsx scripts/demo-videos.ts add              the store, its staff, products, reviews and four weeks of sales
 *                                                   (npm run demo:videos:add; the dev backend must be running)
 *   npx tsx scripts/demo-videos.ts remove           removes every record the videos made (npm run demo:videos:remove)
 *   npx tsx scripts/demo-videos.ts remove-signups   removes only the stores the Owner video signs up live
 *
 * What it makes, all marked as demo:
 * - "Demo: Chai & Clay Co." (slug demo-scout-video-showcase), a PKR store owned by
 *   video-owner@demo.zyro.local, with a Manager (video-manager@) and a Cashier (video-cashier@);
 * - eight products with pictures (scripts/demo-videos/assets), some with an amount off and some with
 *   a percentage off; two discount codes; a shipping zone; cash on delivery and bank transfer on
 *   (a demo bank, fake numbers);
 * - four demo shoppers (video-shopper-*@) and their reviews;
 * - four weeks of sales at the counter and online, a few online orders waiting to be packed, a cash
 *   on delivery order and a bank transfer with its receipt, waiting to be checked.
 *
 * Kept apart from real figures: the slug carries the demo prefix (lib/demo.ts), so the store is left
 * out of the platform figures, Trend Scout, the Growth Advisor run and Product Scout's live numbers
 * (it only feeds the demo snapshot). The shop directory lists it only on a machine that names it in
 * DIRECTORY_SHOWCASE_DEMO_SLUG. Every account is @demo.zyro.local and starts with "video-". The
 * real stores and users are counted before and after, and the script stops if either changes.
 *
 * The stores the Owner video creates live (video-signup-*@demo.zyro.local) cannot carry the demo
 * prefix (sign-up refuses it), so the recording removes them straight after filming (remove-signups).
 */
import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import type mongooseType from "mongoose";

loadDotenv({ path: path.resolve(__dirname, "../.env") });

const API = process.env.DEMO_API ?? "http://localhost:5000/api/v1";
const ASSETS = path.resolve(__dirname, "../../scripts/demo-videos/assets");
const DEMO_EMAIL_DOMAIN = "demo.zyro.local";
const VIDEO_PREFIX = "video-";
const PASSWORD = "Demo-Video-2026";
const STORE = { slug: "demo-scout-video-showcase", name: "Demo: Chai & Clay Co." };
const DAY_MS = 24 * 60 * 60 * 1000;
const command = process.argv[2];

let mongoose: typeof mongooseType;
let prisma: typeof import("../src/lib/prisma").prismaUnscoped;
let scopedPrisma: typeof import("../src/lib/prisma").prisma;
let connectMongo: typeof import("../src/lib/mongo").connectMongo;
let getRedis: typeof import("../src/lib/redis").getRedis;
let closeRedis: typeof import("../src/lib/redis").closeRedis;
let tenantContext: typeof import("../src/lib/tenantContext").tenantContext;
let passwordLib: typeof import("../src/lib/password").password;
let inventoryService: typeof import("../src/modules/inventory/inventory.service").inventoryService;
let getStorage: typeof import("../src/lib/storage").getStorage;
let computePrices: typeof import("../src/lib/prices").computePrices;

async function loadApp() {
  mongoose = (await import("mongoose")).default;
  ({ prismaUnscoped: prisma, prisma: scopedPrisma } = await import("../src/lib/prisma"));
  ({ connectMongo } = await import("../src/lib/mongo"));
  ({ getRedis, closeRedis } = await import("../src/lib/redis"));
  ({ tenantContext } = await import("../src/lib/tenantContext"));
  ({ password: passwordLib } = await import("../src/lib/password"));
  ({ inventoryService } = await import("../src/modules/inventory/inventory.service"));
  ({ getStorage } = await import("../src/lib/storage"));
  ({ computePrices } = await import("../src/lib/prices"));
  const demo = await import("../src/lib/demo");
  if (!demo.isDemoSlug(STORE.slug) || demo.DEMO_EMAIL_DOMAIN !== DEMO_EMAIL_DOMAIN) throw new Error("lib/demo.ts and this script disagree on the demo markers");
}

// ---------------------------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------------------------

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres", "mongo", "mongodb"]);
const hostOf = (url: string | undefined) => {
  try {
    return new URL(url ?? "").hostname;
  } catch {
    return "";
  }
};
function refuseOutsideDevelopment() {
  const problems: string[] = [];
  if (process.env.NODE_ENV === "production") problems.push("NODE_ENV is production");
  if (!LOCAL_HOSTS.has(hostOf(process.env.DATABASE_URL))) problems.push("the Postgres database is not on this machine");
  if (!LOCAL_HOSTS.has(hostOf(process.env.MONGODB_URI ?? process.env.MONGO_URI))) problems.push("the MongoDB database is not on this machine");
  if (!LOCAL_HOSTS.has(hostOf(API))) problems.push("the API is not on this machine");
  if (problems.length) {
    console.error(`Refusing to touch demo data: ${problems.join("; ")}. This script is for a development machine only.`);
    process.exit(1);
  }
}

/** The real data: stores not owned by a demo account (and not demo stores), and users not on the demo domain. */
const realCounts = async () => ({
  stores: await prisma.tenant.count({ where: { NOT: [{ slug: { startsWith: "demo-scout-" } }, { owner: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } } }] } }),
  users: await prisma.user.count({ where: { NOT: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } } } }),
});

const isVideoEmail = (prefix = VIDEO_PREFIX) => ({ AND: [{ email: { startsWith: prefix } }, { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } }] });
const email = (who: string) => `${VIDEO_PREFIX}${who}@${DEMO_EMAIL_DOMAIN}`;

// ---------------------------------------------------------------------------------------------
// The API, as the owner and the demo shoppers use it (the dev backend must be running)
// ---------------------------------------------------------------------------------------------

async function call<T = any>(method: string, p: string, opts: { token?: string; guest?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.guest) headers["X-Guest-Session-Id"] = opts.guest;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(API + p, { method, headers, body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${p.replace(/\/stores\/[^/]+/, "/stores/:id")} answered ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json as T;
}
const signIn = async (who: string) => (await call<{ accessToken: string }>("POST", "/auth/login", { body: { email: who, password: PASSWORD } })).accessToken;
const image = (file: string) => {
  const form = new FormData();
  form.append("file", new Blob([readFileSync(path.join(ASSETS, file))], { type: "image/png" }), file.split("/").pop());
  return form;
};

// ---------------------------------------------------------------------------------------------
// The demo store
// ---------------------------------------------------------------------------------------------

type Discount = { type: "amount" | "percent"; value: number } | null;
const PRODUCTS: { key: string; title: string; category: string; mrp: number; discount: Discount; stock: number; description: string }[] = [
  { key: "clay-chai-cup", title: "Clay Chai Cup (Set of 4)", category: "Kitchen", mrp: 1800, discount: { type: "percent", value: 10 }, stock: 40, description: "Hand-thrown terracotta cups from Gujrat, glazed inside, for doodh patti the way it should taste." },
  { key: "copper-kettle", title: "Copper Kettle 1.5L", category: "Kitchen", mrp: 6500, discount: { type: "amount", value: 500 }, stock: 18, description: "Hammered copper with a brass handle. Holds 1.5 litres and heats evenly on a gas stove." },
  { key: "steel-pateela", title: "Steel Pateela Large", category: "Kitchen", mrp: 3200, discount: null, stock: 30, description: "A heavy-bottomed stainless steel pot for daal, biryani and everyday cooking." },
  { key: "lawn-suit", title: "Lawn Suit 3 Piece", category: "Clothing", mrp: 5500, discount: { type: "percent", value: 20 }, stock: 25, description: "Printed summer lawn with a chiffon dupatta. Unstitched shirt, trousers and dupatta." },
  { key: "embroidered-kurta", title: "Embroidered Kurta", category: "Clothing", mrp: 3800, discount: null, stock: 22, description: "Cotton kurta with hand embroidery at the neckline. Ready to wear." },
  { key: "winter-shawl", title: "Winter Shawl", category: "Clothing", mrp: 2900, discount: { type: "amount", value: 400 }, stock: 15, description: "A soft wool-blend shawl, warm enough for Lahore winters." },
  { key: "scented-candle", title: "Scented Candle", category: "Home decor", mrp: 900, discount: { type: "percent", value: 15 }, stock: 60, description: "Soy wax with a jasmine scent. Burns for about 30 hours." },
  { key: "brass-lamp", title: "Brass Lamp", category: "Home decor", mrp: 7200, discount: null, stock: 8, description: "A hand-polished brass table lamp from Moradabad artisans." },
];

const SHOPPERS = [
  { who: "shopper-ayesha", name: "Ayesha (demo)" },
  { who: "shopper-bilal", name: "Bilal (demo)" },
  { who: "shopper-sana", name: "Sana (demo)" },
  { who: "shopper-hamza", name: "Hamza (demo)" },
];
const REVIEWS: { product: string; shopper: number; rating: number; title: string; comment: string }[] = [
  { product: "clay-chai-cup", shopper: 0, rating: 5, title: "Chai tastes better", comment: "The cups keep tea hot and the glaze is smooth. Packed very well, none broke." },
  { product: "clay-chai-cup", shopper: 1, rating: 4, title: "Lovely set", comment: "Beautiful colour and a good size. One cup was a little uneven but that is the charm of handmade." },
  { product: "clay-chai-cup", shopper: 2, rating: 5, title: "Gifted to my mother", comment: "She loved them. Delivery to Rawalpindi took three days." },
  { product: "clay-chai-cup", shopper: 3, rating: 3, title: "Nice but small", comment: "Good quality, but smaller than I expected. Fine for a small cup of chai." },
  { product: "copper-kettle", shopper: 0, rating: 5, title: "Heavy and well made", comment: "Real copper, heats quickly. Worth the price with the discount." },
  { product: "copper-kettle", shopper: 2, rating: 4, title: "Looks great", comment: "Polishing it takes some effort, but it looks beautiful on the stove." },
  { product: "lawn-suit", shopper: 1, rating: 5, title: "Great print", comment: "Bought it for my sister. The fabric is soft and the colours did not run." },
  { product: "lawn-suit", shopper: 3, rating: 4, title: "Good value", comment: "Nice lawn for the price. The dupatta is lighter than in the picture." },
];

/** A small seeded random, so the demo comes out the same every time. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

async function add() {
  const existing = await prisma.tenant.findUnique({ where: { slug: STORE.slug } });
  if (existing) {
    console.log(`The demo store is already there. Run "remove" first to start again.`);
    return;
  }
  const before = await realCounts();
  console.log(`Real data before: ${before.stores} stores, ${before.users} users.`);

  // The store itself, the way sign-up makes it (owner, store, default location), but with the demo
  // prefix sign-up refuses.
  const passwordHash = await passwordLib.hash(PASSWORD);
  const { tenant } = await scopedPrisma.$transaction(async (tx) => {
    const owner = await tx.user.create({ data: { email: email("owner"), name: "Owner (demo)", passwordHash } });
    const tenant = await tx.tenant.create({
      data: {
        name: STORE.name,
        slug: STORE.slug,
        ownerId: owner.id,
        currency: "PKR",
        listedInDirectory: true,
        description: "Hand-made clay cups, kitchenware and lawn suits from Lahore. A demo store for the walkthrough videos.",
      },
    });
    await tenantContext.run(tenant.id, () => inventoryService.createDefaultLocation(tx, tenant.id));
    return { owner, tenant };
  });
  const storeId = tenant.id;
  const token = await signIn(email("owner"));
  const s = (p: string) => `/stores/${storeId}${p}`;

  // Catalogue, through the API so every rule and every computed price is the real one.
  const categoryIds = new Map<string, string>();
  for (const name of [...new Set(PRODUCTS.map((p) => p.category))]) categoryIds.set(name, (await call("POST", s("/categories"), { token, body: { name } })).id);
  const products = new Map<string, { id: string; title: string; mrp: number; sale: number }>();
  for (const p of PRODUCTS) {
    const file = `products/${p.key}.png`;
    const images = existsSync(path.join(ASSETS, file)) ? [(await call<{ url: string }>("POST", s("/uploads/images"), { token, form: image(file) })).url] : [];
    const created = await call("POST", s("/products"), {
      token,
      body: { title: p.title, description: p.description, actualPrice: p.mrp, ...(p.discount ? { discountType: p.discount.type, discountValue: p.discount.value } : {}), stock: p.stock, categoryId: categoryIds.get(p.category), images, tags: [] },
    });
    products.set(p.key, { id: created.id, title: p.title, mrp: p.mrp, sale: computePrices(p.mrp, p.discount).sale });
  }
  console.log(`  ${products.size} products in ${categoryIds.size} categories`);

  // Staff, the register limit, discount codes, shipping and the ways to pay.
  await call("POST", s("/staff"), { token, body: { email: email("manager"), password: PASSWORD, role: "manager" } });
  await call("POST", s("/staff"), { token, body: { email: email("cashier"), password: PASSWORD, role: "cashier" } });
  await call("PUT", s("/pos/settings"), { token, body: { maxCashierDiscountPercent: 10 } });
  await call("POST", s("/discount-codes"), { token, body: { code: "WELCOME10", type: "percentage", value: 10 } });
  await call("POST", s("/discount-codes"), { token, body: { code: "CHAI200", type: "fixed", value: 200, minSubtotal: 2000 } });
  await call("POST", s("/shipping-zones"), { token, body: { name: "Lahore", region: "Lahore", rateAmount: 150 } });
  await call("POST", s("/shipping-zones"), { token, body: { name: "Rest of Pakistan", region: "Pakistan", rateAmount: 250 } });
  await call("PATCH", s("/payments/settings"), {
    token,
    body: { codEnabled: true, bankTransferEnabled: true, bankAccountName: "Chai & Clay Co. (demo)", bankAccountNumber: "PK00DEMO0000000000", bankName: "Demo Bank" },
  });
  console.log("  a Manager, a Cashier, two discount codes, two shipping zones, cash on delivery and bank transfer");

  // Demo shoppers and their reviews.
  const shopperTokens: string[] = [];
  for (const sh of SHOPPERS) {
    await call("POST", "/auth/register-customer", { body: { email: email(sh.who), password: PASSWORD, name: sh.name } });
    shopperTokens.push(await signIn(email(sh.who)));
  }
  for (const r of REVIEWS) {
    await call("POST", s(`/products/${products.get(r.product)!.id}/reviews`), { token: shopperTokens[r.shopper], body: { rating: r.rating, title: r.title, comment: r.comment } });
  }
  console.log(`  ${SHOPPERS.length} demo shoppers and ${REVIEWS.length} reviews`);

  // Four weeks of sales, written straight to the database (the API can only sell "now"). Each line
  // keeps the price paid, the MRP and the discount, as a real order does.
  const random = seeded(2026);
  const list = [...products.values()];
  const today = new Date();
  const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  let orderNumber = 0;
  const writeOrder = async (o: { daysAgo: number; channel: "ONLINE" | "POS"; status: "PAID" | "FULFILLED" | "COMPLETED"; lines: { p: (typeof list)[number]; qty: number }[]; name: string }) => {
    const subtotal = o.lines.reduce((t, l) => t + Math.round(l.p.sale * 100) * l.qty, 0) / 100;
    const shipping = o.channel === "ONLINE" ? 150 : 0;
    await prisma.order.create({
      data: {
        tenantId: storeId,
        orderNumber: ++orderNumber,
        channel: o.channel,
        status: o.status,
        currency: "PKR",
        subtotal: subtotal.toFixed(2),
        shippingAmount: shipping.toFixed(2),
        total: (subtotal + shipping).toFixed(2),
        guestEmail: o.channel === "ONLINE" ? `customer-${orderNumber}@${DEMO_EMAIL_DOMAIN}` : null,
        shippingName: o.channel === "ONLINE" ? o.name : null,
        shippingAddress: o.channel === "ONLINE" ? { line1: `${10 + orderNumber} Model Town`, line2: null, city: "Lahore", state: "Punjab", postalCode: "54700", country: "PK" } : undefined,
        createdAt: new Date(midnight - o.daysAgo * DAY_MS + (9 + Math.floor(random() * 10)) * 3600_000),
        items: {
          create: o.lines.map((l) => ({
            productId: l.p.id,
            productTitleSnapshot: l.p.title,
            unitPrice: l.p.sale.toFixed(2),
            unitMrpSnapshot: l.p.mrp.toFixed(2),
            unitDiscountSnapshot: (l.p.mrp - l.p.sale).toFixed(2),
            quantity: l.qty,
            lineTotal: (l.p.sale * l.qty).toFixed(2),
          })),
        },
        payments: { create: [{ tenantId: storeId, method: o.channel === "ONLINE" ? "STRIPE" : random() < 0.6 ? "CASH" : "CARD", amount: (subtotal + shipping).toFixed(2), currency: "PKR", status: "SUCCEEDED" }] },
      },
    });
  };
  const names = ["Fatima Malik", "Usman Tariq", "Hira Ahmed", "Zain Raza", "Maryam Iqbal", "Ali Hassan", "Noor Fatima", "Saad Khan"];
  for (let day = 28; day >= 1; day--) {
    const count = 1 + Math.floor(random() * (day <= 7 ? 5 : 4));
    for (let i = 0; i < count; i++) {
      const lines = Array.from({ length: random() < 0.3 ? 2 : 1 }, () => ({ p: list[Math.floor(random() * list.length)], qty: 1 + Math.floor(random() * 2) }));
      await writeOrder({ daysAgo: day, channel: random() < 0.35 ? "POS" : "ONLINE", status: day > 5 ? "COMPLETED" : random() < 0.5 ? "FULFILLED" : "COMPLETED", lines, name: names[Math.floor(random() * names.length)] });
    }
  }
  // Paid online orders from today, waiting to be packed (the Orders chapter ships one).
  for (const [i, key] of ["lawn-suit", "clay-chai-cup", "copper-kettle"].entries()) {
    await writeOrder({ daysAgo: 0, channel: "ONLINE", status: "PAID", lines: [{ p: products.get(key)!, qty: 1 }], name: names[i] });
  }
  await prisma.tenant.update({ where: { id: storeId }, data: { orderCounter: orderNumber } });
  console.log(`  ${orderNumber} orders over four weeks`);

  // A cash on delivery order and a bank transfer with its receipt, placed the way a shopper places
  // them, so the Payments page has something to check.
  const place = async (guest: string, key: string, method: "cod" | "bank_transfer", name: string) => {
    await call("POST", s("/cart/items"), { guest, body: { productId: products.get(key)!.id, quantity: 1 } });
    return call("POST", s("/payments/orders"), { guest, body: { method, name, phone: "03001234567", email: `${guest}@${DEMO_EMAIL_DOMAIN}`, address: { line1: "7 Gulberg III", city: "Lahore", country: "PK" } } });
  };
  await place(`video-guest-cod-${Date.now()}`, "winter-shawl", "cod", "Kiran Shah");
  const transfer = await place(`video-guest-bank-${Date.now()}`, "copper-kettle", "bank_transfer", "Omar Farooq");
  const receipt = new FormData();
  receipt.append("file", new Blob([readFileSync(path.join(ASSETS, "receipt.png"))], { type: "image/png" }), "receipt.png");
  const { key } = await call<{ key: string }>("POST", s(`/payments/orders/${transfer.orderId}/proof-image`), { form: receipt });
  await call("POST", s(`/payments/orders/${transfer.orderId}/proof`), { body: { imageKey: key, declaredAmount: transfer.total, declaredReference: "DEMO-48213" } });
  console.log("  a cash on delivery order and a bank transfer with its receipt, waiting to be checked");

  const after = await realCounts();
  if (after.stores !== before.stores || after.users !== before.users) {
    console.error(`Real data changed (${after.stores} stores, ${after.users} users): stopping. Run "remove" to undo the demo.`);
    process.exit(1);
  }
  console.log(`Done. Real data after: ${after.stores} stores, ${after.users} users (unchanged).`);
  console.log(`Sign in at http://localhost:5173/login as ${email("owner")}, ${email("manager")} or ${email("cashier")} (demo password in scripts/demo-videos/lib.mjs).`);
}

/** Removes the stores (and everything in them) owned by video accounts matching `prefix`, then those accounts. */
async function removeOwnedBy(prefix: string, label: string) {
  const before = await realCounts();
  const tenants = await prisma.tenant.findMany({ where: { owner: isVideoEmail(prefix) }, select: { id: true } });
  const ids = tenants.map((t) => t.id);
  let docs = 0;
  if (ids.length) {
    for (const c of await mongoose.connection.db!.listCollections().toArray()) docs += (await mongoose.connection.db!.collection(c.name).deleteMany({ storeId: { $in: ids } })).deletedCount;
    const redis = getRedis();
    for (const id of ids) {
      const keys = await redis.keys(`cart:${id}:*`);
      if (keys.length) await redis.del(...keys);
      await getStorage().removeStore(id).catch(() => undefined);
    }
  }
  const stores = await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  const users = await prisma.user.deleteMany({ where: { ...isVideoEmail(prefix), ownedTenants: { none: {} } } });
  const after = await realCounts();
  console.log(`Removed ${stores.count} ${label} store(s), ${users.count} demo account(s) and ${docs} catalogue document(s).`);
  console.log(`Real data: ${before.stores} stores and ${before.users} users before, ${after.stores} and ${after.users} after.`);
}

async function main() {
  if (!["add", "remove", "remove-signups"].includes(command)) {
    console.log("Usage: npx tsx scripts/demo-videos.ts add | remove | remove-signups");
    process.exit(1);
  }
  refuseOutsideDevelopment();
  await loadApp();
  await connectMongo();
  try {
    if (command === "add") await add();
    else if (command === "remove") await removeOwnedBy(VIDEO_PREFIX, "video");
    else await removeOwnedBy(`${VIDEO_PREFIX}signup-`, "signed-up");
  } finally {
    await mongoose.disconnect();
    await closeRedis();
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
