import Redis from "ioredis";
import { env } from "../config/env";

let client: Redis | undefined;
let bullClient: Redis | undefined;

/** Shared Redis connection, created on first use so tests and scripts can close it. */
export function getRedis(): Redis {
  if (!client) {
    client = new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });
    client.on("error", (err) => console.error("Redis error:", err.message));
  }
  return client;
}

/**
 * A second connection, reserved for BullMQ (lib/aiQueue.ts). BullMQ's Worker and QueueEvents
 * issue blocking Redis commands and require `maxRetriesPerRequest: null` on their connection;
 * the cart/rate-limit connection above has a finite retry count, so it can't be shared. BullMQ
 * duplicates a passed-in client internally, so one instance here is enough for the Queue,
 * Worker and QueueEvents together.
 */
export function getBullRedis(): Redis {
  if (!bullClient) {
    bullClient = new Redis(env.redisUrl, { maxRetriesPerRequest: null });
    bullClient.on("error", (err) => console.error("BullMQ Redis error:", err.message));
  }
  return bullClient;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = undefined;
  }
  if (bullClient) {
    await bullClient.quit();
    bullClient = undefined;
  }
}
