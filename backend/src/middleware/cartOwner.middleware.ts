import { RequestHandler } from "express";
import { accessToken } from "../lib/jwt";
import { Errors } from "../errors/AppError";

const GUEST_ID = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Identifies whose cart a request is about: the logged-in user (bearer token) or an
 * anonymous browser (X-Guest-Session-Id header, generated and stored by the frontend).
 * A token that is present but invalid is rejected rather than quietly treated as a guest,
 * so an expired login can't silently switch the shopper to an empty guest cart.
 */
export const resolveCartOwner: RequestHandler = (req, _res, next) => {
  const auth = req.headers.authorization;
  if (auth) {
    if (!auth.startsWith("Bearer ")) return next(Errors.unauthorized("Malformed Authorization header"));
    try {
      const payload = accessToken.verify(auth.slice("Bearer ".length));
      req.userId = payload.sub;
      req.cartOwner = { kind: "user", id: payload.sub };
      return next();
    } catch {
      return next(Errors.unauthorized("Access token is invalid or expired"));
    }
  }

  const guest = req.headers["x-guest-session-id"];
  if (typeof guest === "string" && GUEST_ID.test(guest)) {
    req.cartOwner = { kind: "guest", id: guest };
    return next();
  }

  next(Errors.validation("Send a bearer token or an X-Guest-Session-Id header (16 to 64 URL-safe characters)"));
};
