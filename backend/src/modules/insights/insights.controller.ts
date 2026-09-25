import { RequestHandler } from "express";
import { insightsService } from "./insights.service";

export const insightsController = {
  get: (async (req, res, next) => {
    try {
      res.status(200).json(await insightsService.get(req.params.storeId));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  generate: (async (req, res, next) => {
    try {
      res.status(202).json(await insightsService.generate(req.params.storeId));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,
};
