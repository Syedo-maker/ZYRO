import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { meController } from "./me.controller";

// Mounted at /users/me — see app.ts.
export const meRouter = Router();

meRouter.get("/", requireAuth, meController.getProfile);
meRouter.get("/stores", requireAuth, meController.listStores);
