import express, { Router, type RequestHandler } from "express";
import { unsubscribeService } from "./unsubscribe.service";

/**
 * Public: /api/v1/unsubscribe?t=<signed token>. GET tells the page which shop and the current state;
 * POST unsubscribes (the page's button, or the email app's one-click button, which sends the form
 * body "List-Unsubscribe=One-Click"); DELETE turns the reminders back on.
 */
export const unsubscribeRouter = Router();

const handle =
  (run: (token: unknown) => Promise<unknown>): RequestHandler =>
  async (req, res, next) => {
    try {
      res.status(200).json(await run(req.query.t));
    } catch (err) {
      next(err);
    }
  };

unsubscribeRouter.get("/", handle(unsubscribeService.status));
// The one-click button posts a small form body; it is read only to be ignored.
unsubscribeRouter.post("/", express.urlencoded({ extended: false, limit: "1kb" }), handle(unsubscribeService.unsubscribe));
unsubscribeRouter.delete("/", handle(unsubscribeService.resubscribe));
