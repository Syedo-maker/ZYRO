import { RequestHandler } from "express";
import { AppError, Errors } from "../../errors/AppError";
import { getStripeGateway } from "../../lib/stripe";
import { handleStripeEvent } from "./stripe.webhook";

/**
 * Must be mounted with express.raw() (see app.ts): the signature is computed over the
 * exact bytes Stripe sent, so the body cannot be parsed as JSON first.
 * Order of work: verify the signature, then handle the event idempotently.
 */
export const stripeWebhookController: RequestHandler = async (req, res, next) => {
  const signature = req.headers["stripe-signature"];
  if (typeof signature !== "string") return next(Errors.validation("Missing Stripe-Signature header"));

  let event;
  try {
    event = getStripeGateway().constructEvent(req.body as Buffer, signature);
  } catch (err) {
    if (err instanceof AppError) return next(err); // 503: Stripe not configured
    return next(Errors.validation("Signature verification failed"));
  }

  try {
    const outcome = await handleStripeEvent(event);
    res.status(200).json({ received: true, outcome });
  } catch (err) {
    next(err);
  }
};
