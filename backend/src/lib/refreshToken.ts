import crypto from "node:crypto";
import { env } from "../config/env";

const REFRESH_TOKEN_BYTES = 48;

function hash(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export const refreshToken = {
  /** Generates a new opaque refresh token and its hash + expiry, ready to store. */
  generate(): { raw: string; hash: string; expiresAt: Date } {
    const raw = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("hex");
    const expiresAt = new Date(Date.now() + env.jwt.refreshExpiresInDays * 24 * 60 * 60 * 1000);
    return { raw, hash: hash(raw), expiresAt };
  },
  hash,
};
