import { RequestHandler } from "express";
import { accessToken } from "../lib/jwt";
import { Errors } from "../errors/AppError";

/** Verifies the bearer access token and attaches req.userId. Public routes skip this entirely. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(Errors.unauthorized("Missing bearer token"));
  }

  try {
    const payload = accessToken.verify(header.slice("Bearer ".length));
    req.userId = payload.sub;
    next();
  } catch {
    next(Errors.unauthorized("Access token is invalid or expired"));
  }
};
