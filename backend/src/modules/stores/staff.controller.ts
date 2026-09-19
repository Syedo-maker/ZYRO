import { RequestHandler } from "express";
import { staffService } from "./staff.service";
import { createStaffSchema } from "./staff.validation";
import { Errors } from "../../errors/AppError";

export const staffController = {
  list: (async (_req, res, next) => {
    try {
      res.status(200).json(await staffService.list());
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  create: (async (req, res, next) => {
    const parsed = createStaffSchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));

    try {
      const staffMember = await staffService.create(parsed.data);
      res.status(201).json(staffMember);
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,

  remove: (async (req, res, next) => {
    try {
      await staffService.remove(req.params.staffId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,
};
