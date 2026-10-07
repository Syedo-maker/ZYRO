/**
 * Phase 7's performance check: does a shop with thousands of products stay usable?
 *
 *   npx tsx scripts/perf-large-catalogue.ts            5000 products (the Business plan's ceiling)
 *   npx tsx scripts/perf-large-catalogue.ts --count 2000
 *   npx tsx scripts/perf-large-catalogue.ts --keep     leave the shop behind to poke at by hand
 *
 * It builds a throwaway shop, fills it, and times the requests a real shopper and a real merchant
 * actually make, through the real Express app in process. No new tooling: Supertest and
 * `performance.now()`, which is all this question needs.
 *
 * The products are inserted straight into MongoDB rather than through the API, because this is a
 * fixture and not a test of the create endpoint; the reads afterwards are entirely real.
 *
 * It prints a table of median, 95th percentile and worst case per operation, and exits non-zero if
 * any median crosses the budget in BUDGET_MS. The budgets are deliberately generous: this is a
 * development laptop running Postgres, MongoDB, Redis and the app at once, so the point is to catch
 * something that has gone badly wrong, like a missing index turning a page into a table scan, not
 * to measure a production server.
 */
import "dotenv/config";
import request from "supertest";
import { performance } from "node:perf_hooks";

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};

const COUNT = arg("count", 5000);
const RUNS = arg("runs", 12);
const KEEP = process.argv.includes("--keep");

/** What counts as "still usable" for a median response, in milliseconds. */
const BUDGET_MS: Record<string, number> = {
  "storefront: first page of the catalogue": 800,
  "storefront: page 50 of the catalogue": 800,
  "storefront: search for a common word": 1500,
  "storefront: search for a word in one product": 1500,
  "storefront: category list with counts": 1200,
  "storefront: one product's page": 500,
  "storefront: search suggestions as you type": 800,
  "merchant: first page of the product list": 800,
  "merchant: search the product list": 1200,
  "merchant: the dashboard's analytics summary": 2000,
};

const CATEGORIES = ["clothing", "footwear", "home and kitchen", "mobile accessories", "bakery", "jewellery"];
const ADJECTIVES = ["stitched", "handmade", "printed", "embroidered", "cotton", "silk", "summer", "winter", "plain", "classic"];
const NOUNS = ["lawn suit", "khussa", "chai cup", "phone cover", "kurta", "shawl", "earrings", "sandals", "teapot", "scarf"];

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

async function main() {
  const { app } = await import("../src/app");
  const { connectMongo } = await import("../src/lib/mongo");
  const { prismaUnscoped } = await import("../src/lib/prisma");
  const { Product } = await import("../src/models/Product.model");
  const { closeRedis } = await import("../src/lib/redis");
  const mongoose = (await import("mongoose")).default;

  await connectMongo();

  const suffix = Date.now().toString(36);
  const email = `perf-${suffix}@example.com`;
  const api = (method: string, path: string, token?: string) => {
    let r = (request(app) as any)[method.toLowerCase()](`/api/v1${path}`);
    if (token) r = r.set("Authorization", `Bearer ${token}`);
    return r;
  };

  console.log(`Building a shop with ${COUNT} products...`);
  const reg = await api("POST", "/auth/register").send({
    email,
    password: "password123",
    storeName: `Perf ${suffix}`,
    storeSlug: `perf-${suffix}`,
    currency: "PKR",
  });
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
  const token = reg.body.accessToken as string;
  const storeId = (await api("GET", "/users/me/stores", token)).body[0].id as string;
  const userId = reg.body.user.id as string;

  // The plan's product limit is a business rule, not a performance one, so the fixture sits on the
  // plan that allows this many rather than pretending the limit does not exist.
  await prismaUnscoped.tenant.update({ where: { id: storeId }, data: { plan: "BUSINESS" } });

  const started = performance.now();
  const batch = 500;
  for (let from = 0; from < COUNT; from += batch) {
    const docs = Array.from({ length: Math.min(batch, COUNT - from) }, (_, k) => {
      const i = from + k;
      const noun = NOUNS[i % NOUNS.length];
      const adjective = ADJECTIVES[Math.floor(i / NOUNS.length) % ADJECTIVES.length];
      return {
        storeId,
        // A unique word in exactly one product, so one search can be measured against a needle as
        // well as against a haystack.
        title: `${adjective} ${noun} ${i}${i === 4242 ? " zephyrine" : ""}`,
        description: `A ${adjective} ${noun} for everyday use. Item number ${i} in the catalogue.`,
        price: 500 + (i % 90) * 50,
        category: CATEGORIES[i % CATEGORIES.length],
        tags: [adjective, noun.split(" ")[0]],
        images: [],
        taxable: true,
      };
    });
    await Product.insertMany(docs, { ordered: false });
    process.stdout.write(`\r  inserted ${Math.min(from + batch, COUNT)} of ${COUNT}`);
  }
  console.log(`\n  done in ${Math.round(performance.now() - started)} ms\n`);

  const operations: { name: string; run: () => Promise<{ status: number }> }[] = [
    { name: "storefront: first page of the catalogue", run: () => api("GET", `/stores/${storeId}/products?limit=24`) },
    { name: "storefront: page 50 of the catalogue", run: () => api("GET", `/stores/${storeId}/products?limit=24&offset=1176`) },
    { name: "storefront: search for a common word", run: () => api("GET", `/stores/${storeId}/products?q=cotton&limit=24`) },
    { name: "storefront: search for a word in one product", run: () => api("GET", `/stores/${storeId}/products?q=zephyrine&limit=24`) },
    { name: "storefront: category list with counts", run: () => api("GET", `/stores/${storeId}/products/categories`) },
    { name: "storefront: search suggestions as you type", run: () => api("GET", `/stores/${storeId}/products/suggest?q=lawn`) },
    { name: "merchant: first page of the product list", run: () => api("GET", `/stores/${storeId}/products?limit=24`, token) },
    { name: "merchant: search the product list", run: () => api("GET", `/stores/${storeId}/products?q=khussa&limit=24`, token) },
    { name: "merchant: the dashboard's analytics summary", run: () => api("GET", `/stores/${storeId}/analytics/summary?days=30`, token) },
  ];

  // One product's page needs a real id, so it is added after the catalogue exists.
  const anyProduct = (await api("GET", `/stores/${storeId}/products?limit=1`)).body.data?.[0];
  if (anyProduct) {
    operations.splice(5, 0, { name: "storefront: one product's page", run: () => api("GET", `/stores/${storeId}/products/${anyProduct.id}`) });
  }

  console.log(`Timing each operation ${RUNS} times (plus one warm-up that is not counted).\n`);
  const rows: { name: string; median: number; p95: number; worst: number; budget: number; ok: boolean; status: number }[] = [];

  for (const op of operations) {
    await op.run(); // warm-up: the first call pays for connection setup and query planning
    const times: number[] = [];
    let status = 0;
    for (let i = 0; i < RUNS; i += 1) {
      const t0 = performance.now();
      const res = await op.run();
      times.push(performance.now() - t0);
      status = res.status;
    }
    times.sort((x, y) => x - y);
    const budget = BUDGET_MS[op.name] ?? 2000;
    const median = percentile(times, 50);
    rows.push({ name: op.name, median, p95: percentile(times, 95), worst: times[times.length - 1], budget, ok: median <= budget && status === 200, status });
  }

  const width = Math.max(...rows.map((r) => r.name.length));
  console.log(`${"operation".padEnd(width)}  ${"median".padStart(8)} ${"p95".padStart(8)} ${"worst".padStart(8)} ${"budget".padStart(8)}  status`);
  console.log("-".repeat(width + 48));
  for (const r of rows) {
    const mark = r.ok ? "ok" : "OVER";
    console.log(
      `${r.name.padEnd(width)}  ${r.median.toFixed(0).padStart(8)} ${r.p95.toFixed(0).padStart(8)} ${r.worst.toFixed(0).padStart(8)} ${String(r.budget).padStart(8)}  ${r.status} ${mark}`
    );
  }

  const over = rows.filter((r) => !r.ok);
  console.log(`\n${COUNT} products. ${rows.length - over.length} of ${rows.length} operations within budget.`);
  if (over.length > 0) console.log(`Over budget: ${over.map((r) => r.name).join("; ")}`);

  if (!KEEP) {
    await Product.deleteMany({ storeId });
    await prismaUnscoped.tenant.deleteMany({ where: { id: storeId } });
    await prismaUnscoped.user.deleteMany({ where: { id: userId } });
    console.log("Throwaway shop removed.");
  } else {
    console.log(`Shop kept: ${storeId} (sign in as ${email} / password123)`);
  }

  await closeRedis();
  await mongoose.disconnect();
  await prismaUnscoped.$disconnect();
  process.exit(over.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
