import jwt from "jsonwebtoken";
import { env } from "../config/env";

/**
 * Access token payload is deliberately just `{ sub: userId }` — no tenantId baked in.
 * A merchant can own more than one store (nothing in the schema prevents it), so binding
 * a single tenantId at login time would force a re-login every time they switch stores.
 * Instead, every tenant-scoped route carries :storeId in the URL, and authorization
 * middleware checks per-request whether this userId has rights to that specific store
 * (owner match, or a StaffMember row with the right permission) — see requireAuth and
 * requirePermission. This is a deliberate refinement over Implementation_Plan.md's
 * original sketch ("token payload carries userId, tenantId, role").
 */
export interface AccessTokenPayload {
  sub: string;
}

export const accessToken = {
  sign: (userId: string): string =>
    jwt.sign({ sub: userId } satisfies AccessTokenPayload, env.jwt.accessSecret, {
      expiresIn: env.jwt.accessExpiresIn,
    } as jwt.SignOptions),

  verify: (token: string): AccessTokenPayload => {
    return jwt.verify(token, env.jwt.accessSecret) as AccessTokenPayload;
  },
};
