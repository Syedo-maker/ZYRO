/**
 * The startup check of the environment (config/envCheck.ts): every problem reported together, by
 * name and purpose and never by value; the stricter production rules; optional features reported as
 * off; secrets read from `<NAME>_FILE`.
 */
import { checkEnv, formatEnvErrors, loadSecretFiles, resolveAppEnv } from "../../src/config/envCheck";

const base = () => ({
  DATABASE_URL: "postgresql://u:p@localhost:5432/zyro",
  MONGODB_URI: "mongodb://localhost:27017/zyro",
  JWT_ACCESS_SECRET: "a-development-secret",
});

const production = () => ({
  ...base(),
  NODE_ENV: "production",
  JWT_ACCESS_SECRET: "k3J9vQ2mX8rT5wL1nB7cZ4yH6sD0fG9pA2uE5iO8tY1r",
  PUBLIC_URL: "https://shop.example.com",
  CORS_ORIGIN: "https://shop.example.com",
  REDIS_URL: "rediss://cache.example.com:6380",
  STORAGE_DRIVER: "azure",
  AZURE_STORAGE_ACCOUNT_URL: "https://acct.blob.core.windows.net",
  COD_PHONE_PEPPER: "pepper-value",
});

const names = (r: ReturnType<typeof checkEnv>) => r.errors.map((e) => e.name).sort();

describe("the startup environment check", () => {
  it("a minimal development setup passes", () => {
    expect(checkEnv(base()).errors).toEqual([]);
  });

  it("reports every missing required setting at once", () => {
    expect(names(checkEnv({}))).toEqual(["DATABASE_URL", "JWT_ACCESS_SECRET", "MONGODB_URI"]);
  });

  it("checks formats: URLs, numbers, choices", () => {
    const r = checkEnv({ ...base(), DATABASE_URL: "mysql://x", PORT: "abc", TRUST_PROXY: "-1", STORAGE_DRIVER: "s3", LOG_LEVEL: "loud", AI_PROVIDER_ORDER: "anthropic,gemini" });
    expect(names(r)).toEqual(["AI_PROVIDER_ORDER", "DATABASE_URL", "LOG_LEVEL", "PORT", "STORAGE_DRIVER", "TRUST_PROXY"]);
  });

  it("a complete production setup passes", () => {
    const r = checkEnv(production());
    expect(r.errors).toEqual([]);
    expect(r.appEnv).toBe("production");
    expect(r.warnings).toEqual([]);
  });

  it("production also needs the public addresses and Redis, a strong JWT secret and real file storage", () => {
    const p: Record<string, string | undefined> = { ...production(), JWT_ACCESS_SECRET: "short", STORAGE_DRIVER: "local" };
    delete p.PUBLIC_URL;
    delete p.CORS_ORIGIN;
    delete p.REDIS_URL;
    expect(names(checkEnv(p))).toEqual(["CORS_ORIGIN", "JWT_ACCESS_SECRET", "PUBLIC_URL", "REDIS_URL", "STORAGE_DRIVER"]);
  });

  it("staging is production-strict, labelled staging", () => {
    const r = checkEnv({ ...production(), APP_ENV: "staging" });
    expect(r.appEnv).toBe("staging");
    expect(r.isProduction).toBe(true);
    expect(resolveAppEnv({ NODE_ENV: "test" })).toBe("test");
    expect(resolveAppEnv({})).toBe("development");
  });

  it("never puts a value in the message", () => {
    const secret = "postgres-password-123";
    const r = checkEnv({ ...base(), DATABASE_URL: `mysql://zyro:${secret}@db/zyro`, NODE_ENV: "production", JWT_ACCESS_SECRET: "tiny-secret-value" });
    const text = formatEnvErrors(r.errors);
    expect(text).toMatch(/DATABASE_URL/);
    expect(text).not.toContain(secret);
    expect(text).not.toContain("tiny-secret-value");
  });

  it("lists the optional features that are off, by the settings they need", () => {
    const r = checkEnv(base());
    const features = r.disabled.map((d) => d.feature);
    expect(features).toEqual(expect.arrayContaining(["card payments (Stripe Checkout and plan billing)", "AI features", "recommendations and semantic search"]));
    const withAi = checkEnv({ ...base(), ANTHROPIC_API_KEY: "x" });
    expect(withAi.disabled.map((d) => d.feature)).not.toContain("AI features");
  });

  it("warns, without refusing to start, about settings worth a second look in production", () => {
    const p: Record<string, string | undefined> = { ...production(), GATEWAY_MOCK_ENABLED: "true" };
    delete p.COD_PHONE_PEPPER;
    const r = checkEnv(p);
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.name).sort()).toEqual(["COD_PHONE_PEPPER", "GATEWAY_MOCK_ENABLED"]);
  });
});

describe("secrets from files", () => {
  it("reads <NAME>_FILE when <NAME> is not set, trimming the final newline", () => {
    const source: Record<string, string | undefined> = { JWT_ACCESS_SECRET_FILE: "/run/secrets/jwt" };
    const problems = loadSecretFiles(source, (p) => (p === "/run/secrets/jwt" ? "from-a-file\n" : ""));
    expect(problems).toEqual([]);
    expect(source.JWT_ACCESS_SECRET).toBe("from-a-file");
  });

  it("an explicit value wins over the file, and an unreadable file is reported by name", () => {
    const source: Record<string, string | undefined> = { DATABASE_URL: "postgresql://set", DATABASE_URL_FILE: "/nope", MONGODB_URI_FILE: "/missing" };
    const problems = loadSecretFiles(source, (p) => {
      throw new Error(`ENOENT ${p}`);
    });
    expect(source.DATABASE_URL).toBe("postgresql://set");
    expect(problems.map((p) => p.name)).toEqual(["MONGODB_URI_FILE"]);
  });
});
