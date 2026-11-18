import { Router } from "express";
import { authController } from "./auth.controller";
import { requireKnownOrigin } from "../../middleware/knownOrigin.middleware";
import {
  forgotEmailLimiter,
  forgotIpLimiter,
  loginAccountLimiter,
  loginIpLimiter,
  refreshLimiter,
  registerLimiter,
  resetLimiter,
} from "../../middleware/rateLimit.middleware";

export const authRouter = Router();

authRouter.post("/register", registerLimiter, authController.register);
authRouter.post("/register-customer", registerLimiter, authController.registerCustomer);
authRouter.post("/login", loginIpLimiter, loginAccountLimiter, authController.login);
authRouter.post("/refresh", requireKnownOrigin, refreshLimiter, authController.refresh);
authRouter.post("/logout", requireKnownOrigin, authController.logout);
authRouter.post("/forgot-password", forgotIpLimiter, forgotEmailLimiter, authController.forgotPassword);
authRouter.post("/reset-password", resetLimiter, authController.resetPassword);
