/**
 * render.yaml and frontend/vercel.json: they hold no secret, name settings the API accepts in
 * production, keep one Node version, and keep the rewrites in the order the site depends on.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkEnv, SECRET_NAMES } from "../../src/config/envCheck";

const root = path.resolve(__dirname, "../../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const render = read("render.yaml");
const vercel = JSON.parse(read("frontend/vercel.json")) as {
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

/** Every entry under envVars: its name, and its literal value if the file sets one. */
const entries = [...render.matchAll(/- key: (\w+)[^\n]*\n\s+(value: ([^\n]+)|sync: false|generateValue: true|fromDatabase:|fromService:)/g)].map((m) => ({
  name: m[1],
  value: m[3]?.replace(/^"|"$/g, ""),
}));

const placeholder = (name: string) =>
  name === "DATABASE_URL" ? "postgresql://db.example.com/app"
  : name === "MONGODB_URI" ? "mongodb://db.example.com/app"
  : name === "REDIS_URL" ? "redis://cache.example.com:6379"
  : /_URL$|CORS_ORIGIN/.test(name) ? "https://app.example.com"
  : name === "EMAIL_PROVIDER" ? "brevo"
  : "generated-or-entered-in-the-render-dashboard";

describe("render.yaml", () => {
  it("lists the settings", () => {
    expect(entries.length).toBeGreaterThan(15);
    expect(render.match(/- key: /g)).toHaveLength(entries.length);
  });

  it("starts in production with only what it names", () => {
    const source = Object.fromEntries(entries.map((e) => [e.name, e.value ?? placeholder(e.name)]));
    expect(checkEnv(source).errors).toEqual([]);
  });

  it("gives no secret a value", () => {
    const literal = entries.filter((e) => e.value !== undefined).map((e) => e.name);
    for (const name of [...SECRET_NAMES, "DATABASE_URL", "MONGODB_URI", "REDIS_URL"]) expect(literal).not.toContain(name);
    expect(render).not.toMatch(/sk_(live|test)_|whsec_|mongodb(\+srv)?:\/\/|postgres(ql)?:\/\/|rediss?:\/\//);
  });

  it("checks /health, deploys main, applies migrations before the server starts", () => {
    expect(render).toMatch(/healthCheckPath: \/health\n/);
    expect(render).toMatch(/branch: main\n/);
    expect(render).toMatch(/autoDeployTrigger: commit\n/);
    expect(render).toMatch(/startCommand: npx prisma migrate deploy && exec node /);
    expect(render).toMatch(/buildCommand: .*npx prisma generate && npm run build/);
  });

  it("uses the one pinned Node version", () => {
    const pinned = read(".node-version").trim();
    expect(entries.find((e) => e.name === "NODE_VERSION")?.value).toBe(pinned);
    for (const app of ["backend", "frontend"]) {
      expect(JSON.parse(read(`${app}/package.json`)).engines.node).toBe(`${pinned.split(".")[0]}.x`);
    }
  });
});

describe("frontend/vercel.json", () => {
  it("sends the API first and every other address to the app last", () => {
    expect(vercel.rewrites[0].source).toBe("/api/:path*");
    const last = vercel.rewrites[vercel.rewrites.length - 1];
    expect(last.destination).toBe("/index.html");
    expect(new RegExp(`^${last.source}$`).test("/store/abc/products/1")).toBe(true);
    expect(new RegExp(`^${last.source}$`).test("/assets/index.js")).toBe(false);
  });

  it("keeps the site's security headers and holds no secret", () => {
    const names = vercel.headers.flatMap((h) => h.headers.map((x) => x.key));
    for (const name of ["Content-Security-Policy", "Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"]) expect(names).toContain(name);
    expect(read("frontend/vercel.json")).not.toMatch(/sk_(live|test)_|whsec_|mongodb|postgres|VITE_/);
  });
});
