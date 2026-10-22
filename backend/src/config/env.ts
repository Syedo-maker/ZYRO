import path from "node:path";
import { config as loadDotenv } from "dotenv";

// Settings come from backend/.env, by path, whichever folder the process was started from (the repo
// root, backend/, or a script's own folder). Variables already set in the environment win, which is
// how containers and Azure pass theirs; no .env file is shipped there. Secrets in it (the AI, Stripe
// and email keys) are read here only, and never logged.
loadDotenv({ path: path.resolve(__dirname, "../../.env") });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const num = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 1) throw new Error(`${name} must be a positive number`);
  return value;
};

const isProduction = process.env.NODE_ENV === "production";

const jwtAccessSecret = required("JWT_ACCESS_SECRET");
// A weak or copied-from-the-example secret lets anyone forge a login token, so refuse to
// start in production rather than run insecurely.
if (isProduction && (jwtAccessSecret.length < 32 || /replace-with|dev-only|changeme/i.test(jwtAccessSecret))) {
  throw new Error("JWT_ACCESS_SECRET must be a random string of at least 32 characters in production");
}

const storageDriver = process.env.STORAGE_DRIVER === "azure" ? "azure" : "local";
// A container's disk is thrown away whenever it restarts or moves, so in production every upload
// would vanish within days. Refuse to start rather than lose merchants' files quietly; a deployment
// that really does have a persistent disk (a single VM) can say so explicitly.
if (isProduction && storageDriver === "local" && process.env.ALLOW_LOCAL_STORAGE_IN_PRODUCTION !== "true") {
  throw new Error("STORAGE_DRIVER must be 'azure' in production (or set ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true on a host with a persistent disk)");
}

export const env = {
  isProduction,
  port: Number(process.env.PORT ?? 5000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  databaseUrl: required("DATABASE_URL"),
  mongoUri: required("MONGODB_URI"),
  uploadsDir: process.env.UPLOADS_DIR ?? "uploads",
  publicUrl: process.env.PUBLIC_URL ?? "http://localhost:5000",
  // Where uploaded files live (lib/storage.ts). Product images are public; payment receipts and
  // voice notes are private and only ever handed out as short-lived signed links.
  storage: {
    driver: storageDriver as "local" | "azure",
    /** The local driver's private area. Never served as static files. */
    privateDir: process.env.PRIVATE_UPLOADS_DIR ?? "uploads-private",
    /** How long a signed link to a private file works. Long enough for a merchant to review a
     *  page of receipts, short enough that a link copied out of the dashboard soon stops working. */
    privateLinkSeconds: num("PRIVATE_FILE_LINK_SECONDS", 60 * 60),
    /** Signs the local driver's private links. Derived from the JWT secret when not set, under its
     *  own label, so the two are never interchangeable. */
    signingSecret: process.env.FILE_SIGNING_SECRET ?? `zyro-file-links:${jwtAccessSecret}`,
    azure: {
      /** For the Azurite emulator, or an account key. Takes precedence over the account URL. */
      connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
      /** https://<account>.blob.core.windows.net, used with the container app's managed identity. */
      accountUrl: process.env.AZURE_STORAGE_ACCOUNT_URL,
      /** A user-assigned managed identity's client id; unset for a system-assigned one. */
      clientId: process.env.AZURE_CLIENT_ID,
      /** Where browsers fetch files from, when that differs from where the API reaches storage: a
       *  CDN or custom domain in front of Blob Storage, or the emulator's address as seen from the
       *  host. Links are rewritten to it; a SAS signature does not cover the host, so they still work. */
      publicBaseUrl: process.env.AZURE_STORAGE_PUBLIC_URL,
      publicContainer: process.env.AZURE_STORAGE_PUBLIC_CONTAINER ?? "public",
      privateContainer: process.env.AZURE_STORAGE_PRIVATE_CONTAINER ?? "private",
    },
  },
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  // How the process starts and stops (lib/lifecycle.ts).
  lifecycle: {
    /** Every request is answered within this, or it gets a 503. The longest legitimate wait is an
     *  AI generation (AI_JOB_TIMEOUT_MS, 60 s), so this sits above it. */
    requestTimeoutMs: num("REQUEST_TIMEOUT_MS", 90_000),
    /** Time to finish in-flight work after SIGTERM. Below Container Apps' default 30 s, so the
     *  process exits by itself rather than being killed. */
    shutdownGraceMs: num("SHUTDOWN_GRACE_MS", 25_000),
    /** Each dependency in the readiness probe must answer within this. */
    readinessTimeoutMs: num("READINESS_TIMEOUT_MS", 2_000),
  },
  // The background jobs (AI generations, cart recovery, the weekly advisor and trend reports).
  // In production they run in their own container (src/worker.ts), so they scale and restart apart
  // from the API; on a developer's machine they run inside the API so one command starts everything.
  workers: {
    inProcess: process.env.RUN_WORKERS_IN_API ? process.env.RUN_WORKERS_IN_API === "true" : !isProduction,
    /** The worker container's own health endpoint. */
    healthPort: Number(process.env.WORKER_HEALTH_PORT ?? 5001),
  },
  cartTtlSeconds: Number(process.env.CART_TTL_SECONDS ?? 7 * 24 * 60 * 60),
  // How many reverse proxies sit in front of the API (0 = none). Needed so rate limits see
  // each visitor's real IP instead of the proxy's; leave at 0 when clients connect directly.
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),
  // Abuse protection, backed by Redis so limits survive restarts and are shared between servers.
  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED !== "false",
    prefix: process.env.RATE_LIMIT_PREFIX ?? "rl:",
    windowMinutes: num("RATE_LIMIT_WINDOW_MINUTES", 15),
    /** Failed logins allowed per email and IP per window before that pair is blocked. */
    loginMax: num("RATE_LIMIT_LOGIN_MAX", 5),
    /** Failed logins allowed per IP across all emails per window (credential stuffing). */
    loginIpMax: num("RATE_LIMIT_LOGIN_IP_MAX", 30),
    /** Registrations allowed per IP per hour. */
    registerMax: num("RATE_LIMIT_REGISTER_MAX", 20),
    /** Silent-login refresh calls per IP per window (one per page load). */
    refreshMax: num("RATE_LIMIT_REFRESH_MAX", 600),
    /** Discount codes that turn out to be wrong, per IP per window: stops guessing codes. */
    discountMax: num("RATE_LIMIT_DISCOUNT_MAX", 20),
    /** Reviews written, edited or deleted per person per hour. */
    reviewMax: num("RATE_LIMIT_REVIEW_MAX", 10),
    /** Chat messages sent to the AI shopping assistant per person per minute. */
    chatMax: num("RATE_LIMIT_CHAT_MAX", 10),
    /** All API requests per IP per minute. */
    apiMax: num("RATE_LIMIT_API_MAX", 600),
  },
  // Countries a shopper may ship to, as ISO codes. A single list for every store for now;
  // it belongs in per-store settings once those exist.
  shippingCountries: (process.env.SHIPPING_COUNTRIES ?? "US,CA,GB,AU,DE,FR,PK,AE")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean),
  // Where shoppers land after Stripe Checkout. Defaults to the storefront's own origin.
  storefrontUrl: process.env.STOREFRONT_URL ?? process.env.CORS_ORIGIN ?? "http://localhost:5173",
  // Stripe is optional at startup so the rest of the API runs without keys; the checkout
  // and webhook endpoints answer 503 until these are set.
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },
  jwt: {
    accessSecret: jwtAccessSecret,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? "15m",
    refreshExpiresInDays: Number(process.env.JWT_REFRESH_EXPIRES_IN_DAYS ?? 7),
  },
  // AI Orchestrator (Implementation_Plan.md Phase 4). Optional at startup, like Stripe: the
  // rest of the API runs without a key, and AI endpoints answer 503 until it is set.
  ai: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    // Cost control (Part A): each kind of request uses the cheapest model that does it well
    // (lib/aiModels.ts decides which). "fast" is for short structured outputs and chat replies,
    // "standard" for writing a merchant will publish. Neither needs the largest model; setting
    // AI_MODEL_STANDARD=claude-opus-5 upgrades the writing tasks in one line, and the plan
    // prices in lib/plans.ts must then be re-checked (they are, at startup, against the
    // ceilings there).
    models: {
      fast: process.env.AI_MODEL_FAST ?? "claude-haiku-4-5",
      standard: process.env.AI_MODEL_STANDARD ?? process.env.AI_MODEL ?? "claude-sonnet-5",
    },
    /** A prompt (system plus caller text) longer than this is cut, so no one call can cost more than the ceilings in lib/plans.ts assume. About 4,000 tokens. */
    maxPromptChars: num("AI_MAX_PROMPT_CHARS", 16_000),
    /** Identical requests for a repeatable task are answered from Redis for this long, without a new AI call or quota. 0 turns caching off. */
    cacheSeconds: Number(process.env.AI_CACHE_SECONDS ?? 24 * 60 * 60),
    /** The FREE plan's monthly allowance (see lib/plans.ts; Pro and Business have their own). */
    monthlyGenerationsLimit: num("AI_MONTHLY_GENERATIONS_LIMIT", 15),
    monthlyChatMessagesLimit: num("AI_MONTHLY_CHAT_MESSAGES_LIMIT", 40),
    /** How long a caller of generate() waits for the BullMQ job before giving up. */
    jobTimeoutMs: num("AI_JOB_TIMEOUT_MS", 60_000),
  },
  // Plans and billing (Part A, revenue model). Stripe Billing uses the same Stripe keys as
  // checkout above; the plan catalog itself is in lib/plans.ts.
  billing: {
    /** A paid plan keeps working this long after its paid period ends, so a renewal webhook that
     *  arrives a little late does not flicker the store down to Free. After it, the store is Free. */
    graceHours: num("PLAN_GRACE_HOURS", 24),
  },
  // Abandoned-cart recovery (Implementation_Plan.md Phase 5, Module 7 remainder).
  cartRecovery: {
    /** A cart with no activity for this long is "abandoned" (the plan's own example: 2 hours). */
    abandonedAfterHours: num("CART_RECOVERY_ABANDONED_AFTER_HOURS", 2),
    /** How often the repeatable BullMQ job re-scans Redis for newly-abandoned carts. */
    scanIntervalHours: num("CART_RECOVERY_SCAN_INTERVAL_HOURS", 1),
    /** A cart is not emailed again within this long of its last recovery email, even if the
     *  job keeps finding it still abandoned on every later scan. */
    cooldownHours: num("CART_RECOVERY_COOLDOWN_HOURS", 24),
  },
  // Transactional email (recovery emails only, so far). Optional at startup, like Stripe and the
  // AI orchestrator: the scan job runs and logs "would have sent" without a real send until set.
  email: {
    /** Which provider lib/email.ts sends through; each names the settings it needs there. */
    provider: (process.env.EMAIL_PROVIDER?.trim() || "sendgrid").toLowerCase(),
    sendgridApiKey: process.env.SENDGRID_API_KEY,
    brevoApiKey: process.env.BREVO_API_KEY,
    brevoFromEmail: process.env.BREVO_FROM_EMAIL,
    /** The name shown with the Brevo sender address. */
    brevoFromName: process.env.BREVO_FROM_NAME?.trim() || "ZYRO",
    fromEmail: process.env.SENDGRID_FROM_EMAIL,
  },
  // Recommendation microservice (Implementation_Plan.md Phase 6): a separate Python process.
  // Optional at startup like Stripe and the AI key: without a URL and token the store works as
  // before, recommendations come back empty, and the assistant falls back to keyword matching.
  recommendation: {
    url: process.env.RECOMMENDATION_SERVICE_URL,
    token: process.env.RECOMMENDATION_SERVICE_TOKEN,
    /** A shopper is waiting on the product page, so a slow service is given up on quickly. */
    timeoutMs: num("RECOMMENDATION_TIMEOUT_MS", 4000),
    /** How long a computed recommendation list is reused before the service is asked again. */
    cacheSeconds: num("RECOMMENDATION_CACHE_SECONDS", 60),
  },
  // AI business insights (Implementation_Plan.md Phase 5, the last item).
  insights: {
    /** A product with no InventoryLevel.lowStockThreshold set (Phase 0 schema, never wired up
     *  before this) falls back to this fixed floor. */
    lowStockFallbackThreshold: num("LOW_STOCK_FALLBACK_THRESHOLD", 5),
    /** How many days of recent sales the demand forecast averages a daily sell-through rate over. */
    velocityWindowDays: num("INSIGHTS_VELOCITY_WINDOW_DAYS", 14),
    /** A product forecast to run out within this many days is flagged, even above its threshold. */
    forecastDaysThreshold: num("INSIGHTS_FORECAST_DAYS_THRESHOLD", 7),
    /** GET /stores/:id/insights reports the cached write-up stale once it is this many hours old. */
    staleAfterHours: num("INSIGHTS_STALE_AFTER_HOURS", 24),
  },
};
