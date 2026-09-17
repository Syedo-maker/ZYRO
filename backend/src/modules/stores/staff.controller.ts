import { RequestHandler } from "express";
import { staffService } from "./staff.service";
import { createStaffSchema } from "./staff.validation";
import { Errors } from "../../errors/AppError";

export const staffController = {
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
};
