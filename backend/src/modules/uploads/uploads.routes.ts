import { Router, RequestHandler } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/requireAuth.middleware";
import { withTenantContext } from "../../middleware/tenantContext.middleware";
import { requirePermission } from "../../middleware/requirePermission.middleware";
import { imageUpload } from "../../middleware/upload.middleware";
import { uploadsController } from "./uploads.controller";
import { Errors } from "../../errors/AppError";

// Wraps multer so a rejected file type or an over-size upload becomes our normal
// RFC 7807 400 response instead of falling through to the generic 500 handler.
const handleImageUpload: RequestHandler = (req, res, next) => {
  imageUpload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return next(Errors.validation(err.message));
    }
    if (err) {
      return next(Errors.validation((err as Error).message));
    }
    next();
  });
};

// Mounted at /stores/:storeId/uploads — see app.ts.
export const uploadsRouter = Router({ mergeParams: true });

uploadsRouter.post(
  "/images",
  requireAuth,
  withTenantContext,
  requirePermission("PRODUCTS_WRITE"),
  handleImageUpload,
  uploadsController.createImage
);
