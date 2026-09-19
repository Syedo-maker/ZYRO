import Redis from "ioredis";
import { env } from "../config/env";

let client: Redis | undefined;

/** Shared Redis connection, created on first use so tests and scripts can close it. */
export function getRedis(): Redis {
  if (!client) {
    client = new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });
    client.on("error", (err) => console.error("Redis error:", err.message));
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = undefined;
  }
}
