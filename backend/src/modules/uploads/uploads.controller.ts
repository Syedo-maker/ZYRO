import { RequestHandler } from "express";
import { Errors } from "../../errors/AppError";
import { storeImage } from "../../middleware/upload.middleware";
import { getStorage } from "../../lib/storage";

export const uploadsController = {
  /** Product and branding images: public, so the answer is the image's permanent address. */
  createImage: (async (req, res, next) => {
    try {
      if (!req.file) {
        return next(Errors.validation("No file was uploaded, or it failed type/size validation"));
      }
      const key = await storeImage(req.file.buffer, "products", req.params.storeId);
      res.status(201).json({ url: getStorage().publicUrl(key) });
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,
};
