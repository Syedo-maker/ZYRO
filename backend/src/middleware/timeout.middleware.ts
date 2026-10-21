import type { RequestHandler } from "express";
import { env } from "../config/env";

/**
 * Every request ends. If a handler has not answered within env.lifecycle.requestTimeoutMs, whatever
 * it is waiting on (a stuck database, a dependency that never replies), the caller gets a 503 with a
 * Retry-After instead of a connection that hangs until something else gives up. Anything the handler
 * tries to send afterwards is dropped by the error handler in app.ts.
 *
 * This is the backstop, not the plan: each outbound call has its own, shorter limit (the AI job
 * timeout, the recommendation service timeout), and those answer first with a more useful message.
 */
export const requestTimeout: RequestHandler = (req, res, next) => {
  const timer = setTimeout(() => {
    if (res.headersSent) return;
    req.log?.warn({ timeoutMs: env.lifecycle.requestTimeoutMs }, "request timed out");
    res
      .status(503)
      .set("Retry-After", "5")
      .type("application/problem+json")
      .json({
        type: "https://zyro.dev/errors/request-timeout",
        title: "The request took too long",
        status: 503,
        // Not "nothing happened": the work may still finish after this answer (an order, say), so a
        // blind retry could do it twice. The client is told to look before repeating it.
        detail: "It may still finish. Check whether it did before trying again.",
      });
  }, env.lifecycle.requestTimeoutMs);
  const clear = () => clearTimeout(timer);
  res.once("finish", clear);
  res.once("close", clear);
  next();
};
