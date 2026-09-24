import { RequestHandler } from "express";
import { Errors } from "../../errors/AppError";
import { assistantService } from "./assistant.service";
import { chatSchema } from "./assistant.validation";

export const assistantController = {
  chat: (async (req, res, next) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) return next(Errors.validation(parsed.error.message));
    try {
      res.status(200).json(await assistantService.chat(req.params.storeId, req.cartOwner!, parsed.data.conversationId, parsed.data.message));
    } catch (err) {
      next(err);
    }
  }) satisfies RequestHandler,
};
