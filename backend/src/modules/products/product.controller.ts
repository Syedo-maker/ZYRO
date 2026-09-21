import { RequestHandler } from "express";
import { productService } from "./product.service";
import { productInputSchema, listProductsQuerySchema, suggestQuerySchema } from "./product.validation";
import { Errors } from "../../errors/AppError";

export const productController = {
  list: (async (req, res, next) => {
    const parsed = listProductsQuerySchema.safeParse(req.query);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));

    try {
      const result = await productService.list(req.params.storeId, parsed.data);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  categories: (async (req, res, next) => {
    try {
      res.status(200).json(await productService.categories(req.params.storeId));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  suggest: (async (req, res, next) => {
    const parsed = suggestQuerySchema.safeParse(req.query);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));
    try {
      res.status(200).json(await productService.suggest(req.params.storeId, parsed.data.q));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  create: (async (req, res, next) => {
    const parsed = productInputSchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));

    try {
      const product = await productService.create(req.params.storeId, parsed.data, req.userId);
      res.status(201).json(product);
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  get: (async (req, res, next) => {
    try {
      const product = await productService.get(req.params.storeId, req.params.productId);
      res.status(200).json(product);
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  update: (async (req, res, next) => {
    const parsed = productInputSchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));

    try {
      const product = await productService.update(req.params.storeId, req.params.productId, parsed.data, req.userId);
      res.status(200).json(product);
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  remove: (async (req, res, next) => {
    try {
      await productService.remove(req.params.storeId, req.params.productId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,
};
