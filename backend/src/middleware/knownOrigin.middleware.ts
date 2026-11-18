import { RequestHandler } from "express";
import { env } from "../config/env";
import { Errors } from "../errors/AppError";

/**
 * Protects the two requests a browser authenticates with the sign-in cookie alone (refresh and
 * logout) when that cookie is allowed to cross sites (COOKIE_SAME_SITE=none). Another website could
 * otherwise make a visitor's browser send them; only the web app's own addresses (CORS_ORIGIN) may.
 * With the default same-site cookie the browser already refuses, so this does nothing.
 */
export const requireKnownOrigin: RequestHandler = (req, _res, next) => {
  if (env.cookieSameSite !== "none") return next();
  const origin = req.get("origin");
  if (origin && env.corsOrigins.includes(origin)) return next();
  next(Errors.forbidden("This request did not come from the Zyro web app"));
};
