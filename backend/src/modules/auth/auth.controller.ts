import { RequestHandler } from "express";
import { authService } from "./auth.service";
import { registerSchema, registerCustomerSchema, loginSchema } from "./auth.validation";
import { Errors } from "../../errors/AppError";

const REFRESH_COOKIE_NAME = "refreshToken";
const REFRESH_COOKIE_PATH = "/api/v1/auth";

function setRefreshCookie(res: Parameters<RequestHandler>[1], token: string, expiresAt: Date) {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt,
  });
}

export const authController = {
  register: (async (req, res, next) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));

    try {
      const session = await authService.register(parsed.data);
      setRefreshCookie(res, session.refreshToken, session.refreshTokenExpiresAt);
      res.status(201).json({ accessToken: session.accessToken, user: session.user });
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  registerCustomer: (async (req, res, next) => {
    const parsed = registerCustomerSchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));

    try {
      const session = await authService.registerCustomer(parsed.data);
      setRefreshCookie(res, session.refreshToken, session.refreshTokenExpiresAt);
      res.status(201).json({ accessToken: session.accessToken, user: session.user });
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  login: (async (req, res, next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));

    try {
      const session = await authService.login(parsed.data);
      setRefreshCookie(res, session.refreshToken, session.refreshTokenExpiresAt);
      res.status(200).json({ accessToken: session.accessToken, user: session.user });
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  refresh: (async (req, res, next) => {
    const raw = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!raw) return next(Errors.unauthorized("No refresh token cookie present"));

    try {
      const session = await authService.refresh(raw);
      setRefreshCookie(res, session.refreshToken, session.refreshTokenExpiresAt);
      res.status(200).json({ accessToken: session.accessToken });
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  logout: (async (req, res, next) => {
    const raw = req.cookies?.[REFRESH_COOKIE_NAME];
    try {
      if (raw) await authService.logout(raw);
      res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,
};
