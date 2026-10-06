import { Router, type Request } from "express";
import { z } from "zod";
import { ipKeyGenerator } from "express-rate-limit";
import { Errors } from "../../errors/AppError";
import { demoService } from "./demo.service";

/**
 * Mounted at /demo (see app.ts). Public by necessity: this is the landing page's trending
 * suggestions demo, and the people it exists to convince have no account yet.
 *
 * Being public and AI-backed, it is the one endpoint on the platform a stranger could run a bill
 * up on, so the budget is enforced in demo.service.ts rather than here: a prepared example costs
 * nothing, an identical repeat is served from Redis, and anything genuinely new is capped per
 * visitor AND across all visitors per day, with the platform paying for whatever gets through. It
 * reads nothing about any shop and writes nothing at all.
 */
export const demoRouter = Router();

const suggestSchema = z.object({
  phrase: z.string().trim().min(2).max(60),
  category: z.string().trim().max(60).optional(),
});

/** Who the per-visitor limit counts. An IP, which is the only thing a visitor without an account has. */
const visitorOf = (req: Request) => ipKeyGenerator(req.ip ?? "unknown");

demoRouter.get("/product-ideas/examples", (_req, res) => {
  res.status(200).json({ examples: demoService.examples() });
});

demoRouter.post("/product-ideas", async (req, res, next) => {
  const parsed = suggestSchema.safeParse(req.body ?? {});
  if (!parsed.success) return next(Errors.validation(parsed.error.message));
  try {
    res.status(200).json(await demoService.suggest(parsed.data.phrase, parsed.data.category, visitorOf(req)));
  } catch (err) {
    next(err);
  }
});
