import { Router } from "express";
import { authController } from "./auth.controller";
import {
  loginAccountLimiter,
  loginIpLimiter,
  refreshLimiter,
  registerLimiter,
} from "../../middleware/rateLimit.middleware";

export const authRouter = Router();

authRouter.post("/register", registerLimiter, authController.register);
authRouter.post("/register-customer", registerLimiter, authController.registerCustomer);
authRouter.post("/login", loginIpLimiter, loginAccountLimiter, authController.login);
authRouter.post("/refresh", refreshLimiter, authController.refresh);
authRouter.post("/logout", authController.logout);
