import "dotenv/config";

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

export const env = {
  isProduction,
  port: Number(process.env.PORT ?? 5000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  databaseUrl: required("DATABASE_URL"),
  mongoUri: required("MONGODB_URI"),
  uploadsDir: process.env.UPLOADS_DIR ?? "uploads",
  publicUrl: process.env.PUBLIC_URL ?? "http://localhost:5000",
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
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
    // The model every provider adapter call uses. Short, structured content (a product
    // description, a review summary, a tag list, an SEO snippet) does not need the biggest
    // model; a cheaper/faster one is a one-line env change and does not touch quota accounting,
    // which counts generations, not tokens.
    model: process.env.AI_MODEL ?? "claude-opus-5",
    /** New tenants (and a tenant's first request in a new month) start with this many. */
    monthlyGenerationsLimit: num("AI_MONTHLY_GENERATIONS_LIMIT", 50),
    monthlyChatMessagesLimit: num("AI_MONTHLY_CHAT_MESSAGES_LIMIT", 200),
    /** How long a caller of generate() waits for the BullMQ job before giving up. */
    jobTimeoutMs: num("AI_JOB_TIMEOUT_MS", 60_000),
  },
};
