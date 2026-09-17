import { RequestHandler } from "express";
import { env } from "../../config/env";
import { Errors } from "../../errors/AppError";

export const uploadsController = {
  createImage: (async (req, res, next) => {
    if (!req.file) {
      return next(Errors.validation("No file was uploaded, or it failed type/size validation"));
    }
    const url = `${env.publicUrl}/uploads/${req.file.filename}`;
    res.status(201).json({ url });
  }) satisfies RequestHandler,
};
