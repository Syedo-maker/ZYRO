import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { requireOwner } from "../../middleware/requireOwner.middleware";
import { storeController } from "./store.controller";

// Mounted at /stores/:storeId; see app.ts. Registered after the more specific
// /stores/:storeId/{staff,products,uploads} routers, but Express only matches routes this
// router actually defines ("/" and "/branding"), so mount order doesn't create a conflict.
export const storeRouter = Router({ mergeParams: true });

storeRouter.get("/", storeController.get); // public: no auth, per openapi.yaml
storeRouter.patch("/branding", requireAuth, requireOwner, storeController.updateBranding);
storeRouter.patch("/domain", requireAuth, requireOwner, storeController.updateDomain);
