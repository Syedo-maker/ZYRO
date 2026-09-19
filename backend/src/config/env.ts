import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 5000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  databaseUrl: required("DATABASE_URL"),
  mongoUri: required("MONGODB_URI"),
  uploadsDir: process.env.UPLOADS_DIR ?? "uploads",
  publicUrl: process.env.PUBLIC_URL ?? "http://localhost:5000",
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  cartTtlSeconds: Number(process.env.CART_TTL_SECONDS ?? 7 * 24 * 60 * 60),
  // Stripe is optional at startup so the rest of the API runs without keys; the checkout
  // and webhook endpoints answer 503 until these are set.
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },
  jwt: {
    accessSecret: required("JWT_ACCESS_SECRET"),
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? "15m",
    refreshExpiresInDays: Number(process.env.JWT_REFRESH_EXPIRES_IN_DAYS ?? 7),
  },
};
