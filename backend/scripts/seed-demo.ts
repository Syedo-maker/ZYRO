/**
 * Fills an empty database with DEMO data only: a demo store with its owner, Manager, Cashier and
 * shoppers, products, categories, a published theme, four weeks of sample orders (dates relative to
 * today), and the small demo stores behind Product Scout.
 *
 *   npm run seed:demo
 *   npm run seed:demo -- --allow-existing-stores     (only if you really mean to add it next to real stores)
 *
 * It refuses to run on a database that already has stores which are not demo stores, unless that flag
 * is passed. It needs DATABASE_URL, MONGODB_URI and REDIS_URL, and the migrations already applied.
 * It starts its own short-lived API on this machine, so nothing has to be open to the internet, and
 * never reads or copies data from anywhere else.
 *
 * With DEMO_IMAGE_BASE_URL set, products point at images hosted there (the web app serves them at
 * /demo-assets) instead of uploading to file storage, so they survive on hosts with a temporary disk.
 *
 * The demo sign-ins are printed here and listed in documentation/Demo_Data.md; never on a public page.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(__dirname, "../.env"), quiet: true });

const PORT = Number(process.env.SEED_API_PORT ?? 5077);
const API = `http://127.0.0.1:${PORT}/api/v1`;
const STORE_SLUG = "demo-scout-video-showcase";
const PASSWORD = "Demo-Video-2026";
const DEMO_DOMAIN = "demo.zyro.local";
const allowExisting = process.argv.includes("--allow-existing-stores");

const childEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  NODE_ENV: "development",
  // Marks these runs as the checked seed, so the demo scripts accept a database on another machine.
  ZYRO_DEMO_SEED: "1",
  DEMO_API: API,
  PORT: String(PORT),
  RATE_LIMIT_ENABLED: "false",
  RUN_WORKERS_IN_API: "false",
  // Only signs this run's own short-lived requests.
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || randomBytes(32).toString("hex"),
});

const tsx = (file: string, args: string[] = [], stdio: "inherit" | "ignore" = "inherit"): ChildProcess =>
  spawn(process.execPath, ["--import", "tsx", file, ...args], { cwd: path.resolve(__dirname, ".."), env: childEnv(), stdio });

const finished = (child: ChildProcess) => new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 1)));

async function waitForApi(child: ChildProcess) {
  let exited = false;
  child.once("exit", () => (exited = true));
  for (let i = 0; i < 120 && !exited; i++) {
    const ready = await fetch(`http://127.0.0.1:${PORT}/ready`).then((r) => r.ok, () => false);
    if (ready) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("The temporary API did not become ready. Check DATABASE_URL, MONGODB_URI and REDIS_URL, and that the migrations were applied.");
}

async function call<T>(method: string, p: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(API + p, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${p} answered ${res.status}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

async function publishTheme() {
  const { PRESETS } = await import("../src/modules/themes/theme.presets");
  const { accessToken } = await call<{ accessToken: string }>("POST", "/auth/login", undefined, { email: `video-owner@${DEMO_DOMAIN}`, password: PASSWORD });
  const stores = await call<{ id: string; slug: string }[]>("GET", "/users/me/stores", accessToken);
  const store = stores.find((s) => s.slug === STORE_SLUG);
  if (!store) throw new Error("The demo store was not created.");
  await call("PUT", `/stores/${store.id}/theme/draft`, accessToken, { theme: PRESETS["warm-earth"].theme });
  await call("POST", `/stores/${store.id}/theme/publish`, accessToken);
  return store.id;
}

async function main() {
  const { prismaUnscoped: prisma } = await import("../src/lib/prisma");
  // A real store is any store that is neither a demo store nor owned by a demo account.
  const realStores = await prisma.tenant.count({
    where: { NOT: [{ slug: { startsWith: "demo-scout-" } }, { owner: { email: { endsWith: `@${DEMO_DOMAIN}` } } }] },
  });
  await prisma.$disconnect();
  if (realStores > 0 && !allowExisting) {
    console.error(`Refusing to seed: this database has ${realStores} store(s) that are not demo stores. Nothing was changed.`);
    console.error("Seed an empty database, or pass --allow-existing-stores if you really mean to add demo data next to them.");
    process.exit(1);
  }

  const api = tsx("src/index.ts", [], "ignore");
  try {
    await waitForApi(api);
    for (const [file, args] of [["scripts/demo-videos.ts", ["add"]], ["scripts/demo-product-scout.ts", ["add"]]] as const) {
      const code = await finished(tsx(file, [...args]));
      if (code !== 0) throw new Error(`${file} stopped with exit code ${code}.`);
    }
    const storeId = await publishTheme();
    console.log("\nDemo data is ready. Demo sign-ins (demo data only; do not reuse this password anywhere):");
    for (const role of ["owner", "manager", "cashier", "shopper-ayesha"]) console.log(`  ${role.padEnd(15)} video-${role}@${DEMO_DOMAIN}`);
    console.log(`  password        ${PASSWORD}`);
    console.log(`  demo store      /store/${storeId}`);
  } finally {
    api.kill();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error((err as Error).message);
    process.exit(1);
  },
);
