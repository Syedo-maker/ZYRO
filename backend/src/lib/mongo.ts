import mongoose from "mongoose";
import { env } from "../config/env";
import { logger } from "./logger";

/**
 * The host part of a MongoDB URI, for logs. The whole URI must never be logged: on MongoDB Atlas it
 * carries the database user's password, and this line used to print it at every start.
 */
export function mongoHost(uri: string): string {
  const match = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/.exec(uri);
  return match ? match[1] : "(unparsed)";
}

export async function connectMongo(): Promise<void> {
  // A server that cannot be reached fails the start within 10 s, with a clear message, instead of
  // leaving the process waiting on the driver's 30 s default.
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10_000 });
  logger.info({ host: mongoHost(env.mongoUri) }, "connected to MongoDB");
}
