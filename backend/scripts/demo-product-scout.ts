/**
 * Demo data for Product Scout, on a development machine only.
 *
 *   npx tsx scripts/demo-product-scout.ts add      adds 6 demo stores, their products and 4 weeks of orders,
 *                                                  then builds the demo snapshot (npm run demo:scout:add)
 *   npx tsx scripts/demo-product-scout.ts remove   removes every one of them again (npm run demo:scout:remove)
 *
 * Every demo record is marked: store slugs start with "demo-scout-", store names with "Demo: ", owner
 * emails end in "@demo.zyro.local" (not a real domain, so nothing can be emailed), and customer
 * emails too. Demo stores are left out of every real figure (lib/demo.ts): Product Scout's live
 * snapshot, Trend Scout, the platform page, the Growth Advisor run and the shop directory. Their orders
 * are written straight to the database, so the per-store usage counters are not moved either.
 *
 * It refuses to run unless NODE_ENV is not "production" and both databases are on this machine. It
 * prints the number of real stores and users before and after, and stops if either changes.
 * Sign in as any demo owner with the password printed at the end to see the panel.
 */
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import type mongooseType from "mongoose";

// The settings first, then the safety check, and only then the app itself (some of it checks its own
// production settings as soon as it loads, which would hide this script's clearer refusal).
loadDotenv({ path: path.resolve(__dirname, "../.env") });

let mongoose: typeof mongooseType;
let prisma: typeof import("../src/lib/prisma").prismaUnscoped;
let scopedPrisma: typeof import("../src/lib/prisma").prisma;
let connectMongo: typeof import("../src/lib/mongo").connectMongo;
let getRedis: typeof import("../src/lib/redis").getRedis;
let closeRedis: typeof import("../src/lib/redis").closeRedis;
let tenantContext: typeof import("../src/lib/tenantContext").tenantContext;
let passwordLib: typeof import("../src/lib/password").password;
let categoryService: typeof import("../src/modules/categories/category.service").categoryService;
let productService: typeof import("../src/modules/products/product.service").productService;
let notDemoTenant: typeof import("../src/lib/demo").notDemoTenant;
let inventoryService: typeof import("../src/modules/inventory/inventory.service").inventoryService;
const DEMO_SLUG_PREFIX = "demo-scout-"; // the same as lib/demo.ts, checked in main()
const DEMO_EMAIL_DOMAIN = "demo.zyro.local";

async function loadApp() {
  mongoose = (await import("mongoose")).default;
  ({ prismaUnscoped: prisma, prisma: scopedPrisma } = await import("../src/lib/prisma"));
  ({ connectMongo } = await import("../src/lib/mongo"));
  ({ getRedis, closeRedis } = await import("../src/lib/redis"));
  ({ tenantContext } = await import("../src/lib/tenantContext"));
  ({ password: passwordLib } = await import("../src/lib/password"));
  ({ categoryService } = await import("../src/modules/categories/category.service"));
  ({ productService } = await import("../src/modules/products/product.service"));
  ({ inventoryService } = await import("../src/modules/inventory/inventory.service"));
  const demo = await import("../src/lib/demo");
  if (demo.DEMO_SLUG_PREFIX !== DEMO_SLUG_PREFIX || demo.DEMO_EMAIL_DOMAIN !== DEMO_EMAIL_DOMAIN) throw new Error("lib/demo.ts and this script disagree on the demo markers");
  notDemoTenant = demo.notDemoTenant;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEMO_PASSWORD = "demo-pass-123";
const command = process.argv[2];

// ---------------------------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------------------------

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres", "mongo", "mongodb"]);
function hostOf(url: string | undefined): string {
  try {
    return new URL(url ?? "").hostname;
  } catch {
    return "";
  }
}
function refuseOutsideDevelopment() {
  const problems: string[] = [];
  if (process.env.NODE_ENV === "production") problems.push("NODE_ENV is production");
  const pg = hostOf(process.env.DATABASE_URL);
  const mongo = hostOf(process.env.MONGODB_URI ?? process.env.MONGO_URI);
  if (!LOCAL_HOSTS.has(pg)) problems.push(`the Postgres database is on "${pg || "unknown"}", not this machine`);
  if (!LOCAL_HOSTS.has(mongo)) problems.push(`the MongoDB database is on "${mongo || "unknown"}", not this machine`);
  if (problems.length) {
    console.error(`Refusing to touch demo data: ${problems.join("; ")}. This script is for a development machine only.`);
    process.exit(1);
  }
}

const realCounts = async () => ({
  stores: await prisma.tenant.count({ where: notDemoTenant }),
  users: await prisma.user.count({ where: { NOT: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } } } }),
});

// ---------------------------------------------------------------------------------------------
// The demo: six shops in Pakistan, overlapping ranges, four weeks of orders
// ---------------------------------------------------------------------------------------------

/** A product type the demo sells: how each store spells it, and how its weekly sales move. */
interface Line {
  category: string;
  titles: string[]; // one per store that sells it, in store order; "" = that store does not sell it
  price: number;
  /** Units per store per week, oldest week first (weeks 4, 3, 2, 1 = the last 7 days). */
  weekly: [number, number, number, number];
}

const STORES = [
  { key: "karachi-kitchen", name: "Demo: Karachi Kitchenware" },
  { key: "lahore-threads", name: "Demo: Lahore Threads" },
  { key: "pindi-toys", name: "Demo: Pindi Toy Box" },
  { key: "multan-bazaar", name: "Demo: Multan Bazaar" },
  { key: "quetta-home", name: "Demo: Quetta Home Store" },
  { key: "peshawar-mart", name: "Demo: Peshawar Mart" },
];

const LINES: Line[] = [
  // Every product meant to be seen is sold by four stores in fairly even amounts, so it passes all three
  // privacy rules (3 stores, no store over 60%, no two over 85%) in every week, with room to spare.
  // Rising fast in the last week.
  { category: "Kitchen", titles: ["Clay Chai Cup", "", "", "clay chai cup (set)", "CLAY CHAI CUP", "Clay Chai Cup 250ml", ], price: 450, weekly: [2, 3, 4, 9] },
  { category: "Kitchen", titles: ["Copper Kettle 1.5L", "", "", "copper kettle", "Copper Kettle", "Copper Kettle"], price: 3200, weekly: [3, 3, 4, 5] },
  { category: "Kitchen", titles: ["Steel Pateela", "", "", "Steel Pateela Large", "steel pateela", "Steel Pateela"], price: 1800, weekly: [4, 4, 3, 3] },
  // The best seller, steady.
  { category: "Clothing", titles: ["", "Lawn Suit 3 Piece", "", "lawn suit", "Lawn Suit", "Lawn Suit"], price: 4500, weekly: [8, 9, 10, 11] },
  { category: "Clothing", titles: ["", "Embroidered Kurta", "", "Embroidered Kurta", "embroidered kurta", "embroidered kurta"], price: 3800, weekly: [5, 5, 6, 6] },
  // New this week only: nothing in the weeks before.
  { category: "Clothing", titles: ["", "Winter Shawl", "", "Winter Shawl", "Winter Shawl", "WINTER SHAWL"], price: 2900, weekly: [0, 0, 0, 7] },
  { category: "Toys", titles: ["", "", "Rubber Duck", "rubber duck", "Rubber Duck", "Rubber Duck 2 Pack"], price: 350, weekly: [6, 6, 7, 7] },
  { category: "Toys", titles: ["", "", "Wooden Puzzle", "Wooden Puzzle", "wooden puzzle", "Wooden Puzzle"], price: 950, weekly: [2, 3, 3, 6] },
  // Falling.
  { category: "Home decor", titles: ["Scented Candle", "", "", "Scented Candle", "Scented Candle", "scented candle"], price: 700, weekly: [9, 8, 6, 4] },
  // The two that must stay hidden, each in a category of its own, so the categories above still pass
  // the rules once what is shown in them is taken away. Sold by only two stores: never shown.
  { category: "Outdoor", titles: ["", "", "Kite", "", "", "kite"], price: 400, weekly: [5, 6, 8, 12] },
  // Three stores, but one sells nearly all of it: hidden too.
  { category: "Lighting", titles: ["", "", "", "Brass Lamp", "brass lamp", "Brass Lamp"], price: 5200, weekly: [1, 1, 1, 1] },
];
/** What the panel must show, for 7 and for 30 days, and what it must not. */
const SHOWN = ["Clay chai cup", "Copper kettle", "Steel pateela", "Lawn suit", "Embroidered kurta", "Winter shawl", "Rubber duck", "Wooden puzzle", "Scented candle"];
const SHOWN_CATEGORIES = ["Kitchen", "Clothing", "Toys", "Home decor"];
const HIDDEN = ["Kite", "Brass lamp", "Outdoor", "Lighting"];
// The brass lamp's one dominant seller (store index 3, Multan Bazaar) sells far more than the others.
const DOMINANT = { title: "Brass Lamp", storeIndex: 3, weekly: [12, 14, 15, 18] as [number, number, number, number] };

/** A small seeded random, so the demo comes out the same every time. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

async function add() {
  const existing = await prisma.tenant.count({ where: { slug: { startsWith: DEMO_SLUG_PREFIX } } });
  if (existing > 0) {
    console.log(`The demo is already there (${existing} demo stores). Run "remove" first to start again.`);
    return;
  }
  const before = await realCounts();
  console.log(`Real data before: ${before.stores} stores, ${before.users} users.`);

  const passwordHash = await passwordLib.hash(DEMO_PASSWORD);
  const random = seeded(2026);
  // Product Scout's periods end at the start of today (UTC), so the demo's weeks do too: each week's
  // orders fall inside the same 7 days the panel counts, and the demo comes out the same whenever it runs.
  const today = new Date();
  const periodEnd = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  let orders = 0;

  for (const [i, s] of STORES.entries()) {
    // The same three rows sign-up makes (auth.service.ts): the owner, the store and its default location.
    const { owner, tenant } = await scopedPrisma.$transaction(async (tx) => {
      const owner = await tx.user.create({ data: { email: `${DEMO_SLUG_PREFIX}${s.key}@${DEMO_EMAIL_DOMAIN}`, name: s.name.replace("Demo: ", ""), passwordHash } });
      const tenant = await tx.tenant.create({
        data: { name: s.name, slug: `${DEMO_SLUG_PREFIX}${s.key}`, ownerId: owner.id, currency: "PKR", listedInDirectory: false, growthTipsEnabled: false },
      });
      await tenantContext.run(tenant.id, () => inventoryService.createDefaultLocation(tx, tenant.id));
      return { owner, tenant };
    });

    const mine = LINES.filter((l) => l.titles[i]);
    const productIds = new Map<string, { id: string; title: string; price: number; weekly: [number, number, number, number] }>();
    await tenantContext.run(tenant.id, async () => {
      const categoryIds = new Map<string, string>();
      for (const name of [...new Set(mine.map((l) => l.category))]) categoryIds.set(name, (await categoryService.create(tenant.id, { name })).id);
      for (const l of mine) {
        const p = await productService.create(tenant.id, { title: l.titles[i], description: "", actualPrice: l.price, stock: 500, categoryId: categoryIds.get(l.category)!, images: [], tags: [], taxable: true }, owner.id);
        const weekly = l.titles[i].toLowerCase() === DOMINANT.title.toLowerCase() && i === DOMINANT.storeIndex ? DOMINANT.weekly : l.weekly;
        productIds.set(p.id, { id: p.id, title: l.titles[i], price: l.price, weekly });
      }
    });

    // Four weeks of orders: each week's units spread over its days, one to three units per order.
    let orderNumber = 1;
    for (const p of productIds.values()) {
      for (let week = 0; week < 4; week++) {
        let left = Math.round(p.weekly[week] * (0.85 + random() * 0.3));
        while (left > 0) {
          const qty = Math.min(left, 1 + Math.floor(random() * 3));
          left -= qty;
          const daysAgo = (3 - week) * 7 + Math.floor(random() * 7) + 0.5; // within that week of the last 28 days
          const roll = random();
          const status = roll < 0.06 ? "CANCELLED" : roll < 0.1 ? "REFUNDED" : roll < 0.14 ? "PENDING" : roll < 0.6 ? "COMPLETED" : "PAID";
          await prisma.order.create({
            data: {
              tenantId: tenant.id,
              orderNumber: orderNumber++,
              channel: random() < 0.75 ? "ONLINE" : "POS",
              status,
              currency: "PKR",
              subtotal: (qty * p.price).toFixed(2),
              total: (qty * p.price).toFixed(2),
              guestEmail: `customer-${orderNumber}@${DEMO_EMAIL_DOMAIN}`,
              createdAt: new Date(periodEnd - daysAgo * DAY_MS),
              items: { create: [{ productId: p.id, productTitleSnapshot: p.title, unitPrice: p.price.toFixed(2), quantity: qty, lineTotal: (qty * p.price).toFixed(2) }] },
            },
          });
          orders++;
        }
      }
    }
    console.log(`  ${s.name}: ${productIds.size} products`);
  }

  const after = await realCounts();
  if (after.stores !== before.stores || after.users !== before.users) {
    console.error(`Real data changed (${after.stores} stores, ${after.users} users): stopping. Run "remove" to undo the demo.`);
    process.exit(1);
  }
  console.log(`Added ${STORES.length} demo stores and ${orders} demo orders over 4 weeks. Real data after: ${after.stores} stores, ${after.users} users (unchanged).`);

  console.log("Building the demo snapshot (the AI writes the explanations; the platform pays)...");
  const { scoutService } = await import("../src/modules/scout/scout.service");
  const { startAiWorker, closeAiQueue } = await import("../src/lib/aiQueue");
  startAiWorker();
  const result = await scoutService.refresh({ scopes: ["demo"] });
  await closeAiQueue();
  console.log(`  ${result.snapshots.join(", ") || "no snapshot (too little data)"}`);
  await checkSnapshots();
  console.log(`\nSign in at http://localhost:5173/login as any demo owner, for example`);
  console.log(`  ${DEMO_SLUG_PREFIX}${STORES[0].key}@${DEMO_EMAIL_DOMAIN}   password: ${DEMO_PASSWORD}`);
}

/**
 * The demo is built to pass all three privacy rules for every product meant to be seen, and to fail
 * them for the two meant to stay hidden. Say plainly if a snapshot does not show exactly that.
 */
async function checkSnapshots() {
  let ok = true;
  for (const s of await prisma.productScoutSnapshot.findMany({ where: { scope: "demo", market: "PKR" } })) {
    const data = s.data as { products?: { name: string }[]; categories?: { name: string }[] };
    const products = (data.products ?? []).map((p) => p.name);
    const categories = (data.categories ?? []).map((c) => c.name);
    const missing = SHOWN.filter((n) => !products.includes(n));
    const leaked = HIDDEN.filter((n) => products.includes(n) || categories.includes(n));
    const missingCategories = SHOWN_CATEGORIES.filter((n) => !categories.includes(n));
    if (missing.length || leaked.length || missingCategories.length) {
      ok = false;
      console.error(`  ${s.periodDays} days: missing ${[...missing, ...missingCategories].join(", ") || "nothing"}; shown but should not be: ${leaked.join(", ") || "nothing"}`);
    } else console.log(`  ${s.periodDays} days: ${products.length} products and ${categories.length} categories shown, as designed; the kite and the brass lamp hidden.`);
  }
  if (!ok) console.error("The demo does not show what it was designed to. Check the LINES above against the privacy rules.");
}

async function remove() {
  const before = await realCounts();
  const tenants = await prisma.tenant.findMany({ where: { slug: { startsWith: DEMO_SLUG_PREFIX } }, select: { id: true } });
  const ids = tenants.map((t) => t.id);

  // Every MongoDB document that belongs to a demo store, in any collection that has storeId.
  let docs = 0;
  if (ids.length) {
    for (const c of await mongoose.connection.db!.listCollections().toArray()) {
      const r = await mongoose.connection.db!.collection(c.name).deleteMany({ storeId: { $in: ids } });
      docs += r.deletedCount;
    }
    const redis = getRedis();
    for (const id of ids) {
      const keys = await redis.keys(`cart:${id}:*`);
      if (keys.length) await redis.del(...keys);
    }
  }
  const stores = await prisma.tenant.deleteMany({ where: { id: { in: ids } } }); // orders, staff and the rest go with them
  const users = await prisma.user.deleteMany({ where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` }, ownedTenants: { none: {} } } });
  const snapshots = await prisma.productScoutSnapshot.deleteMany({ where: { scope: "demo" } });

  const after = await realCounts();
  console.log(`Removed ${stores.count} demo stores, ${users.count} demo users, ${docs} catalogue documents and ${snapshots.count} demo snapshots.`);
  console.log(`Real data: ${before.stores} stores and ${before.users} users before, ${after.stores} and ${after.users} after.`);
}

async function main() {
  if (command !== "add" && command !== "remove") {
    console.log('Usage: npx tsx scripts/demo-product-scout.ts add | remove');
    process.exit(1);
  }
  refuseOutsideDevelopment();
  await loadApp();
  await connectMongo();
  try {
    if (command === "add") await add();
    else await remove();
  } finally {
    await mongoose.disconnect();
    await closeRedis();
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
