import { RequestHandler } from "express";
import { Errors } from "../../errors/AppError";
import { categoryService } from "./category.service";
import { createCategorySchema, updateCategorySchema } from "./category.validation";

export const categoryController = {
  list: (async (req, res, next) => {
    try {
      res.status(200).json(await categoryService.list(req.params.storeId));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  create: (async (req, res, next) => {
    const parsed = createCategorySchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.issues.map((i) => i.message).join("; ")));
    try {
      res.status(201).json(await categoryService.create(req.params.storeId, parsed.data));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  update: (async (req, res, next) => {
    const parsed = updateCategorySchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.issues.map((i) => i.message).join("; ")));
    try {
      res.status(200).json(await categoryService.update(req.params.storeId, req.params.categoryId, parsed.data));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  remove: (async (req, res, next) => {
    try {
      await categoryService.remove(req.params.storeId, req.params.categoryId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,
};
