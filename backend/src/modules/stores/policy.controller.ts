import { RequestHandler } from "express";
import { Errors } from "../../errors/AppError";
import { policyBodySchema, policyService } from "./policy.service";

export const policyController = {
  list: (async (req, res, next) => {
    try {
      res.status(200).json(await policyService.list(req.params.storeId));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  set: (async (req, res, next) => {
    const parsed = policyBodySchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.issues.map((i) => i.message).join("; ")));
    try {
      res.status(200).json(await policyService.set(req.params.storeId, req.params.kind, parsed.data.body));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,
};
