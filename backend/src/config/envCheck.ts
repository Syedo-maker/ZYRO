import { readFileSync } from "node:fs";

/**
 * Startup check of the environment (production readiness, 2026-11).
 *
 * Every setting Zyro reads is checked once, before anything else starts, and every problem is
 * reported together: the variable's NAME, what is wrong with it, and what it is needed for. Values
 * are never printed, so the message is safe in any log.
 *
 *   errors    the process must not start: a required setting is missing or a value is malformed
 *   disabled  optional features that stay off because their settings are not there (Stripe, AI,
 *             email...), so an operator can see at a glance what this deployment can and cannot do
 *
 * Environments: APP_ENV is development, test, staging or production (default: production when
 * NODE_ENV=production, test when NODE_ENV=test, otherwise development). Staging and production both
 * run with NODE_ENV=production and get the strict rules; APP_ENV only labels them (logs, error
 * tracking). Nothing environment-specific is written in the code: it all comes from variables.
 *
 * Secrets can come from the environment (a platform's secret store injects them there), from
 * backend/.env on a developer's machine, or from files: for any secret below, `NAME_FILE=/path`
 * reads the value from that file (Docker and Kubernetes secrets are mounted this way).
 */

export const APP_ENVS = ["development", "test", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/** Settings that may be provided as `<NAME>_FILE`. */
export const SECRET_NAMES = [
  "DATABASE_URL",
  "MONGODB_URI",
  "REDIS_URL",
  "JWT_ACCESS_SECRET",
  "FILE_SIGNING_SECRET",
  "COD_PHONE_PEPPER",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "SENDGRID_API_KEY",
  "BREVO_API_KEY",
  "RECOMMENDATION_SERVICE_TOKEN",
  "AZURE_STORAGE_CONNECTION_STRING",
  "GATEWAY_MOCK_SECRET",
  "APPLICATIONINSIGHTS_CONNECTION_STRING",
  "SENTRY_DSN",
] as const;

export interface EnvProblem {
  name: string;
  problem: string;
  neededFor: string;
}

export interface EnvReport {
  appEnv: AppEnv;
  isProduction: boolean;
  errors: EnvProblem[];
  disabled: { feature: string; missing: string[] }[];
  /** Allowed, but worth an operator's attention (logged at startup by name, never by value). */
  warnings: { name: string; message: string }[];
}

type Source = Record<string, string | undefined>;

/**
 * For each secret with a `<NAME>_FILE` and no `<NAME>`, reads the file into `<NAME>`. A file that
 * cannot be read is an error (reported by name and path variable only).
 */
export function loadSecretFiles(source: Source, read: (path: string) => string = (p) => readFileSync(p, "utf8")): EnvProblem[] {
  const problems: EnvProblem[] = [];
  for (const name of SECRET_NAMES) {
    const file = source[`${name}_FILE`];
    if (!file || source[name]) continue;
    try {
      source[name] = read(file).replace(/\r?\n$/, "");
    } catch {
      problems.push({ name: `${name}_FILE`, problem: "the file it names cannot be read", neededFor: `the value of ${name}` });
    }
  }
  return problems;
}

const set = (v: string | undefined) => v !== undefined && v.trim() !== "";

const POSITIVE_NUMBERS: Record<string, string> = {
  PRIVATE_FILE_LINK_SECONDS: "links to private files",
  REQUEST_TIMEOUT_MS: "request timeouts",
  SHUTDOWN_GRACE_MS: "graceful shutdown",
  READINESS_TIMEOUT_MS: "the readiness check",
  RATE_LIMIT_WINDOW_MINUTES: "rate limits",
  RATE_LIMIT_LOGIN_MAX: "rate limits",
  RATE_LIMIT_LOGIN_IP_MAX: "rate limits",
  RATE_LIMIT_REGISTER_MAX: "rate limits",
  RATE_LIMIT_REFRESH_MAX: "rate limits",
  RATE_LIMIT_DISCOUNT_MAX: "rate limits",
  RATE_LIMIT_REVIEW_MAX: "rate limits",
  RATE_LIMIT_FORGOT_IP_MAX: "rate limits",
  RATE_LIMIT_FORGOT_EMAIL_MAX: "rate limits",
  RATE_LIMIT_RESET_MAX: "rate limits",
  RATE_LIMIT_CHAT_MAX: "rate limits",
  RATE_LIMIT_CHAT_IP_MAX: "rate limits",
  RATE_LIMIT_HELP_MAX: "rate limits",
  RATE_LIMIT_THEME_AI_MAX: "rate limits",
  RATE_LIMIT_THEME_AI_STORE_MAX: "rate limits",
  RATE_LIMIT_API_MAX: "rate limits",
  AI_MAX_PROMPT_CHARS: "AI cost limits",
  AI_MONTHLY_GENERATIONS_LIMIT: "the Free plan's AI allowance",
  AI_MONTHLY_CHAT_MESSAGES_LIMIT: "the Free plan's AI allowance",
  AI_JOB_TIMEOUT_MS: "AI requests",
  PLAN_GRACE_HOURS: "plans and billing",
  CART_RECOVERY_ABANDONED_AFTER_HOURS: "cart recovery emails",
  CART_RECOVERY_SCAN_INTERVAL_HOURS: "cart recovery emails",
  CART_RECOVERY_COOLDOWN_HOURS: "cart recovery emails",
  RECOMMENDATION_TIMEOUT_MS: "recommendations",
  RECOMMENDATION_CACHE_SECONDS: "recommendations",
  LOW_STOCK_FALLBACK_THRESHOLD: "business insights",
  INSIGHTS_VELOCITY_WINDOW_DAYS: "business insights",
  INSIGHTS_FORECAST_DAYS_THRESHOLD: "business insights",
  INSIGHTS_STALE_AFTER_HOURS: "business insights",
  PORT: "the API server",
  WORKER_HEALTH_PORT: "the worker's health check",
  JWT_REFRESH_EXPIRES_IN_DAYS: "sign-in sessions",
  CART_TTL_SECONDS: "shopping carts",
};

const NON_NEGATIVE_NUMBERS: Record<string, string> = {
  TRUST_PROXY: "client addresses behind a proxy (rate limits, logs)",
  AI_CACHE_SECONDS: "the AI answer cache",
};

const CHOICES: Record<string, { values: string[]; neededFor: string }> = {
  STORAGE_DRIVER: { values: ["local", "azure"], neededFor: "file uploads" },
  EMAIL_PROVIDER: { values: ["sendgrid", "brevo"], neededFor: "email" },
  LOG_LEVEL: { values: ["fatal", "error", "warn", "info", "debug", "trace", "silent"], neededFor: "logging" },
  LOG_FORMAT: { values: ["json", "pretty"], neededFor: "logging" },
  APP_ENV: { values: [...APP_ENVS], neededFor: "the environment label" },
  RATE_LIMIT_ENABLED: { values: ["true", "false"], neededFor: "rate limits" },
  RUN_WORKERS_IN_API: { values: ["true", "false"], neededFor: "background jobs" },
  ALLOW_LOCAL_STORAGE_IN_PRODUCTION: { values: ["true", "false"], neededFor: "file uploads" },
};

const URLS: Record<string, { schemes: string[]; neededFor: string }> = {
  DATABASE_URL: { schemes: ["postgresql:", "postgres:"], neededFor: "the database (everything)" },
  MONGODB_URI: { schemes: ["mongodb:", "mongodb+srv:"], neededFor: "the catalogue (products, reviews, AI content)" },
  REDIS_URL: { schemes: ["redis:", "rediss:"], neededFor: "carts, rate limits, background jobs" },
  PUBLIC_URL: { schemes: ["http:", "https:"], neededFor: "links to uploaded files and emails" },
  CORS_ORIGIN: { schemes: ["http:", "https:"], neededFor: "the web app calling the API" },
  STOREFRONT_URL: { schemes: ["http:", "https:"], neededFor: "links back to the storefront after payment" },
  RECOMMENDATION_SERVICE_URL: { schemes: ["http:", "https:"], neededFor: "recommendations and semantic search" },
  AZURE_STORAGE_ACCOUNT_URL: { schemes: ["https:"], neededFor: "file uploads" },
  AZURE_STORAGE_PUBLIC_URL: { schemes: ["http:", "https:"], neededFor: "file uploads" },
};

const OPTIONAL_FEATURES: { feature: string; needs: (s: Source) => string[] }[] = [
  { feature: "card payments (Stripe Checkout and plan billing)", needs: (s) => ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"].filter((n) => !set(s[n])) },
  { feature: "AI features", needs: (s) => (set(s.ANTHROPIC_API_KEY) || set(s.OPENAI_API_KEY) ? [] : ["ANTHROPIC_API_KEY (or OPENAI_API_KEY)"]) },
  {
    feature: "sending email (cart recovery, password reset)",
    needs: (s) => ((s.EMAIL_PROVIDER ?? "sendgrid").toLowerCase() === "brevo" ? ["BREVO_API_KEY", "BREVO_FROM_EMAIL"] : ["SENDGRID_API_KEY", "SENDGRID_FROM_EMAIL"]).filter((n) => !set(s[n])),
  },
  { feature: "recommendations and semantic search", needs: (s) => ["RECOMMENDATION_SERVICE_URL", "RECOMMENDATION_SERVICE_TOKEN"].filter((n) => !set(s[n])) },
  { feature: "telemetry (Application Insights)", needs: (s) => (set(s.APPLICATIONINSIGHTS_CONNECTION_STRING) ? [] : ["APPLICATIONINSIGHTS_CONNECTION_STRING"]) },
];

export function resolveAppEnv(source: Source): AppEnv {
  const explicit = source.APP_ENV?.trim().toLowerCase();
  if (explicit && (APP_ENVS as readonly string[]).includes(explicit)) return explicit as AppEnv;
  if (source.NODE_ENV === "production") return "production";
  if (source.NODE_ENV === "test") return "test";
  return "development";
}

export function checkEnv(source: Source): EnvReport {
  const appEnv = resolveAppEnv(source);
  const isProduction = source.NODE_ENV === "production";
  const errors: EnvProblem[] = [];
  const add = (name: string, problem: string, neededFor: string) => errors.push({ name, problem, neededFor });

  // Always required.
  for (const [name, neededFor] of [
    ["DATABASE_URL", URLS.DATABASE_URL.neededFor],
    ["MONGODB_URI", URLS.MONGODB_URI.neededFor],
    ["JWT_ACCESS_SECRET", "sign-in (signing session tokens)"],
  ] as const) {
    if (!set(source[name])) add(name, "missing", neededFor);
  }

  // Required in production (staging included): without them the app would start pointing at localhost.
  if (isProduction) {
    for (const name of ["PUBLIC_URL", "CORS_ORIGIN", "REDIS_URL"] as const) {
      if (!set(source[name])) add(name, "missing (required when NODE_ENV=production)", URLS[name].neededFor);
    }
    const jwt = source.JWT_ACCESS_SECRET ?? "";
    if (set(jwt) && (jwt.length < 32 || /replace-with|dev-only|changeme/i.test(jwt))) {
      add("JWT_ACCESS_SECRET", "must be a random string of at least 32 characters in production", "sign-in (signing session tokens)");
    }
    const driver = source.STORAGE_DRIVER === "azure" ? "azure" : "local";
    if (driver === "local" && source.ALLOW_LOCAL_STORAGE_IN_PRODUCTION !== "true") {
      add("STORAGE_DRIVER", "must be 'azure' in production (or set ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true on a host with a persistent disk)", "file uploads");
    }
    if (driver === "azure" && !set(source.AZURE_STORAGE_CONNECTION_STRING) && !set(source.AZURE_STORAGE_ACCOUNT_URL)) {
      add("AZURE_STORAGE_ACCOUNT_URL", "missing (or set AZURE_STORAGE_CONNECTION_STRING)", "file uploads");
    }
  }

  for (const [name, { schemes, neededFor }] of Object.entries(URLS)) {
    const value = source[name];
    if (!set(value)) continue;
    let ok = false;
    try {
      ok = schemes.includes(new URL(value!.trim()).protocol);
    } catch {
      ok = false;
    }
    if (!ok) add(name, `must be a ${schemes.map((s) => s.replace(":", "")).join(" or ")} URL`, neededFor);
  }

  for (const [name, neededFor] of Object.entries(POSITIVE_NUMBERS)) {
    if (!set(source[name])) continue;
    const n = Number(source[name]);
    if (!Number.isFinite(n) || n < 1) add(name, "must be a positive number", neededFor);
  }
  for (const [name, neededFor] of Object.entries(NON_NEGATIVE_NUMBERS)) {
    if (!set(source[name])) continue;
    const n = Number(source[name]);
    if (!Number.isInteger(n) || n < 0) add(name, "must be a whole number, 0 or more", neededFor);
  }
  for (const [name, { values, neededFor }] of Object.entries(CHOICES)) {
    if (!set(source[name])) continue;
    if (!values.includes(source[name]!.trim().toLowerCase())) add(name, `must be one of: ${values.join(", ")}`, neededFor);
  }
  if (set(source.AI_PROVIDER_ORDER)) {
    const unknown = source.AI_PROVIDER_ORDER!.split(",").map((p) => p.trim().toLowerCase()).filter((p) => p && !["anthropic", "openai"].includes(p));
    if (unknown.length) add("AI_PROVIDER_ORDER", "may only list anthropic and openai", "AI features");
  }
  if (set(source.APPLICATIONINSIGHTS_SAMPLING_RATIO)) {
    const r = Number(source.APPLICATIONINSIGHTS_SAMPLING_RATIO);
    if (!(r > 0 && r <= 1)) add("APPLICATIONINSIGHTS_SAMPLING_RATIO", "must be a number above 0 and at most 1", "telemetry");
  }

  const disabled = OPTIONAL_FEATURES.map(({ feature, needs }) => ({ feature, missing: needs(source) })).filter((d) => d.missing.length > 0);

  const warnings: EnvReport["warnings"] = [];
  if (isProduction && !set(source.COD_PHONE_PEPPER)) {
    warnings.push({ name: "COD_PHONE_PEPPER", message: "not set: cash-on-delivery phone signals are hashed with a public fallback value, so they could be reversed" });
  }
  if (isProduction && source.GATEWAY_MOCK_ENABLED === "true") {
    warnings.push({ name: "GATEWAY_MOCK_ENABLED", message: "the test payment gateway is switched on in production" });
  }
  if (isProduction && source.RATE_LIMIT_ENABLED === "false") {
    warnings.push({ name: "RATE_LIMIT_ENABLED", message: "rate limits are switched off in production" });
  }
  return { appEnv, isProduction, errors, disabled, warnings };
}

/** The message a failed start prints: names and reasons only, never a value. */
export function formatEnvErrors(errors: EnvProblem[]): string {
  const lines = errors.map((e) => `  - ${e.name}: ${e.problem} (needed for ${e.neededFor})`);
  return [
    `Zyro cannot start: ${errors.length} environment ${errors.length === 1 ? "variable is" : "variables are"} missing or invalid.`,
    ...lines,
    "Set them in the environment (or backend/.env for local development). Values are never printed.",
  ].join("\n");
}

export class EnvError extends Error {
  constructor(readonly problems: EnvProblem[]) {
    super(formatEnvErrors(problems));
    this.name = "EnvError";
  }
}
