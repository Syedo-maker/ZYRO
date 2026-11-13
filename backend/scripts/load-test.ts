/**
 * A basic load test of the main flows (production readiness, 2026-11), with autocannon.
 *
 *   npx tsx scripts/load-test.ts [baseUrl] [seconds] [connections] [flows]
 *   default: http://localhost:8080 (the production-like compose stack), 20 s per flow, 20 connections,
 *   all flows (or a comma-separated list of: browse, login, checkout)
 *
 * It creates one test store (an e2e-load- email, removed by scripts/cleanup-test-data.ts) with 30
 * products, then runs each flow on its own:
 *
 *   browse    the storefront: store profile, a product page, the product list, a search
 *   login     signing in (a correct password, so the failed-login limit is not what is measured)
 *   checkout  a shopper with their own cart adds a product and asks for a checkout quote
 *
 * Rate limits answer 429 once a single address goes over them; to measure capacity rather than the
 * limits, run the stack with RATE_LIMIT_ENABLED=false (compose.loadtest.yaml does that).
 */
import autocannon from "autocannon";
import { randomUUID } from "node:crypto";

const base = (process.argv[2] ?? "http://localhost:8080").replace(/\/+$/, "");
const seconds = Number(process.argv[3] ?? 20);
const connections = Number(process.argv[4] ?? 20);
const only = process.argv[5]?.split(",").map((f) => f.trim());
const API = `${base}/api/v1`;

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

type Flow = { name: string; options: autocannon.Options };

async function main() {
  const tag = Date.now().toString(36);
  const email = `e2e-load-${tag}@example.com`;
  const password = "load-test-password-1";
  const reg = await call("POST", "/auth/register", { email, password, storeName: `E2E Load ${tag}`, storeSlug: `e2e-load-${tag}`, currency: "PKR" });
  const token = reg.accessToken as string;
  const storeId = (await call("GET", "/users/me/stores", undefined, token))[0].id as string;
  const productIds: string[] = [];
  for (let i = 0; i < 30; i++) {
    const p = await call("POST", `/stores/${storeId}/products`, { title: `Load test mug ${i}`, price: 400 + i, stock: 100000, category: i % 2 ? "kitchen" : "home" }, token);
    productIds.push(p.id);
  }
  const pick = () => productIds[Math.floor(Math.random() * productIds.length)];
  console.log(`Store ${storeId} with ${productIds.length} products. ${seconds} s per flow, ${connections} connections, against ${base}\n`);

  const flows: Flow[] = [
    {
      name: "browse (storefront)",
      options: {
        url: base,
        requests: [
          { method: "GET", path: `/api/v1/stores/${storeId}` },
          { method: "GET", setupRequest: (r) => ({ ...r, path: `/api/v1/stores/${storeId}/products/${pick()}` }) },
          { method: "GET", path: `/api/v1/stores/${storeId}/products?limit=24` },
          { method: "GET", path: `/api/v1/stores/${storeId}/products?q=mug&limit=24` },
        ],
      },
    },
    {
      name: "login",
      options: {
        url: `${API}/auth/login`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      },
    },
    {
      name: "checkout (cart + quote)",
      options: {
        url: base,
        // Each connection is one shopper with their own cart: the id is kept in the connection's context
        // and sent on every request (request-level headers replace the client's own in autocannon).
        requests: [
          {
            method: "POST",
            path: `/api/v1/stores/${storeId}/cart/items`,
            setupRequest: (r, context: { guest?: string }) => {
              context.guest ??= `load-${randomUUID()}`;
              return { ...r, headers: { "Content-Type": "application/json", "X-Guest-Session-Id": context.guest }, body: JSON.stringify({ productId: pick(), quantity: 1 }) };
            },
          },
          {
            method: "POST",
            path: `/api/v1/stores/${storeId}/checkout/quote`,
            setupRequest: (r, context: { guest?: string }) => ({ ...r, headers: { "Content-Type": "application/json", "X-Guest-Session-Id": context.guest ?? `load-${randomUUID()}` }, body: "{}" }),
          },
        ],
      },
    },
  ];

  const rows = [];
  for (const flow of flows.filter((f) => !only || only.some((o) => f.name.startsWith(o)))) {
    // Kept apart: what each client-side error was (a reset connection, a timeout), not just how many.
    const errorKinds: Record<string, number> = {};
    const instance = autocannon({ ...flow.options, connections, duration: seconds });
    instance.on("reqError", (err: NodeJS.ErrnoException) => {
      const kind = err.code ?? err.name ?? "error";
      errorKinds[kind] = (errorKinds[kind] ?? 0) + 1;
    });
    const result = await instance;
    const codes = Object.entries(result.statusCodeStats ?? {}).map(([c, s]) => `${c}:${(s as { count: number }).count}`).join(" ");
    rows.push({
      flow: flow.name,
      "req/s": Math.round(result.requests.average),
      "p50 ms": result.latency.p50,
      "p97.5 ms": result.latency.p97_5,
      "p99 ms": result.latency.p99,
      requests: result.requests.total,
      errors: result.errors + result.timeouts,
      "error kinds": Object.entries(errorKinds).map(([k, n]) => `${k}:${n}`).join(" ") || (result.timeouts ? `timeout:${result.timeouts}` : ""),
      codes,
    });
  }
  console.table(rows);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
