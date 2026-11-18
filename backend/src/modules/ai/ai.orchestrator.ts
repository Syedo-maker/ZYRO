import { createHash } from "node:crypto";
import { env } from "../../config/env";
import { Errors } from "../../errors/AppError";
import { getAiQueue, readyAiQueueEvents, type AiJobData } from "../../lib/aiQueue";
import type { Job, QueueEvents } from "bullmq";
import { aiConfigured, type AiGenerateResult } from "../../lib/aiProvider";
import { allowsImage, modelFor, tierFor } from "../../lib/aiModels";
import { FRIENDLY_AI_UNAVAILABLE } from "../../lib/aiErrors";
import { getRedis } from "../../lib/redis";
import { reserveQuota, releaseQuota, quotaExhaustedError, recordTokens, recordCachedAnswer, chargeLateAnswer, currentMonth, type AiUsageKind } from "./ai.quota.service";
import { logger } from "../../lib/logger";
import { aiRequests } from "../../lib/metrics";
import { aiDisabled, takeDailyAllowance } from "../../lib/aiLimits";

export interface GenerateInput {
  tenantId: string;
  /** Names the prompt template a future module uses (e.g. "product_description",
   *  "review_summary", "auto_tag", "seo_metadata", "chat"). Carried through to the job for
   *  logging, and decides which model answers (lib/aiModels.ts); this module defines no prompt
   *  templates itself. */
  promptType: string;
  /** Which quota counter this call draws from. Everything except the shopping assistant
   *  (Phase 5, Module 3) is a "generation"; only its chat turns are "chat". */
  kind?: AiUsageKind;
  system: string;
  prompt: string;
  maxTokens?: number;
  /**
   * Opt in for tasks whose answer only depends on their input (tags, SEO text, a summary of the
   * same reviews): an identical request from the same store is answered from Redis, with no new
   * AI call and no quota spent. Never set it where a fresh, different answer is the point
   * (regenerate, "write another version", chat).
   */
  cache?: boolean;
  /**
   * Who pays. `store` (the default) spends the store's monthly allowance. `platform` is for features
   * the platform runs on its own initiative (the Growth Advisor): no quota is reserved or spent and the
   * store's token counters are not touched; the caller records the cost where the platform can see it.
   */
  billedTo?: "store" | "platform";
  /**
   * An image for the model to look at (Part E's payment screenshots). Only prompt types listed in
   * lib/aiModels.ts as vision prompts may send one; anything else is a programming error and is
   * refused here, so a picture can never be sent to the AI by accident. Never cached: two different
   * screenshots would otherwise share one answer.
   */
  image?: { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string };
}

/**
 * The single interface every AI feature calls through (Implementation_Plan.md Phase 4: "a
 * single internal service wraps all LLM calls behind one interface"). Modules 3 and 6 are
 * built on this; it defines no prompt templates or endpoints of its own.
 *
 * Order of operations matters here: quota is reserved atomically *before* the job is enqueued
 * (so two concurrent calls can never both slip past an exhausted limit - a security review
 * flagged the earlier check-then-increment version as a race), and given back if the job
 * fails, so a failed generation never costs the tenant a turn they didn't get
 * (Implementation_Plan.md Phase 4, `AiUsageQuota` note).
 *
 * Cost controls (Part A): the model is chosen per prompt type (cheaper for short tasks), an
 * over-long prompt is cut so one call has a hard cost ceiling, and repeatable tasks can be
 * answered from a per-store cache. Cached answers cost no quota because no AI call happened.
 */
export async function generate(input: GenerateInput): Promise<AiGenerateResult> {
  return (await generateRevocable(input)).result;
}

/**
 * The same as generate(), for a caller whose use of the answer can still fail afterwards (an email
 * that will not send): `release()` gives the store back the turn this call took, so the store is only
 * charged for an answer that was actually used. The tokens stay recorded, because the AI call did
 * happen and cost what it cost (Part B). A cached answer took no turn, so its release does nothing;
 * calling release more than once gives back one turn at most.
 */
export async function generateRevocable(input: GenerateInput): Promise<{ result: AiGenerateResult; release: () => Promise<void> }> {
  const kind: AiUsageKind = input.kind ?? "generation";
  const model = modelFor(input.promptType);
  const maxTokens = input.maxTokens ?? 1024;
  const platformPays = input.billedTo === "platform";

  if (input.image && !allowsImage(input.promptType)) {
    throw new Error(`promptType "${input.promptType}" is not allowed to send an image (see VISION_PROMPTS in lib/aiModels.ts)`);
  }

  // The kill switch (AI_DISABLED=true, lib/aiLimits.ts): every AI feature off at once, nothing spent.
  if (aiDisabled()) {
    aiRequests.inc({ outcome: "disabled", prompt_type: input.promptType });
    throw Errors.serviceUnavailable("AI features are switched off for now. Everything else works as usual, and nothing was used from your AI allowance.");
  }

  // The cap covers the system text plus the caller's text; the caller's text is what gets cut
  // (the end of it: reviews are fed newest first, so the oldest go).
  const room = Math.max(1000, env.ai.maxPromptChars - input.system.length);
  const prompt = input.prompt.length > room ? input.prompt.slice(0, room) : input.prompt;

  const cacheKey =
    input.cache && !input.image && env.ai.cacheSeconds > 0
      ? `ai:cache:${input.tenantId}:${createHash("sha256").update(JSON.stringify([input.promptType, model, input.system, prompt, maxTokens])).digest("hex")}`
      : undefined;
  if (cacheKey) {
    try {
      const hit = await getRedis().get(cacheKey);
      if (hit) {
        if (!platformPays) await recordCachedAnswer(input.tenantId).catch((err: Error) => logger.error({ err: err.message, tenantId: input.tenantId }, "AI usage count failed"));
        const cached = JSON.parse(hit) as AiGenerateResult;
        return { result: { ...cached, text: tidyText(cached.text) }, release: async () => {} }; // an answer cached before tidyText existed is tidied too
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "AI cache read failed"); // a cache problem only costs a real call
    }
  }

  // No AI provider set up at all: say so at once. Queueing the job would only retry it three times
  // with backoff (about 6 s) before giving the same answer, which kept a shopper submitting a receipt
  // waiting for nothing. No quota is touched.
  if (!aiConfigured()) {
    aiRequests.inc({ outcome: "unavailable", prompt_type: input.promptType });
    throw Errors.serviceUnavailable(FRIENDLY_AI_UNAVAILABLE);
  }

  // Today's limits, per store and for the whole platform (AI_DAILY_STORE_LIMIT, AI_DAILY_GLOBAL_LIMIT).
  const daily = await takeDailyAllowance(input.tenantId, platformPays);
  if ("refused" in daily) {
    aiRequests.inc({ outcome: "daily_limit", prompt_type: input.promptType });
    throw Errors.serviceUnavailable(
      daily.refused === "store"
        ? "This store has reached today's AI limit. AI is available again tomorrow, and nothing was used from your monthly allowance."
        : FRIENDLY_AI_UNAVAILABLE
    );
  }

  const month = currentMonth();
  const source = platformPays ? null : await reserveQuota(input.tenantId, kind, month);
  if (!platformPays && !source) {
    await daily.giveBack();
    aiRequests.inc({ outcome: "quota_exhausted", prompt_type: input.promptType });
    throw await quotaExhaustedError(input.tenantId, kind);
  }

  // Listening first: a job that finished before the listener was reading would look like a timeout.
  const events = await readyAiQueueEvents();
  const job = await getAiQueue().add(
    input.promptType,
    {
      tenantId: input.tenantId,
      promptType: input.promptType,
      model,
      tier: tierFor(input.promptType),
      system: input.system,
      prompt,
      maxTokens,
      image: input.image,
    } satisfies AiJobData,
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    }
  );

  let result: AiGenerateResult;
  try {
    const raw: AiGenerateResult = await job.waitUntilFinished(events, env.ai.jobTimeoutMs);
    result = { ...raw, text: tidyText(raw.text) };
  } catch (err) {
    // The store received nothing, so it is not charged now: the reservation goes back to where it
    // came from. A job still queued is taken off the queue so it never runs. One the worker is
    // already running may still finish, and then the provider has done the work: that turn and its
    // tokens are charged when it does, so a timeout can no longer hide real spend (audit 2026-11).
    const fate = await abandonJob(job);
    if (source) await releaseQuota(input.tenantId, kind, source, month);
    await daily.giveBack();
    if (fate === "running" && !platformPays) chargeIfItFinishes(job, events, input.tenantId, kind, month);
    // Whatever went wrong (missing key, the provider down, a timeout), this is the API
    // being unable to fulfil the request right now, not something the caller did wrong. The
    // provider's own words go to the log, where they can be acted on; the merchant or shopper gets
    // a sentence they can act on instead of an SDK error.
    logger.error(
      { err: err instanceof Error ? err.message : String(err), tenantId: input.tenantId, promptType: input.promptType, model },
      "AI generation failed"
    );
    aiRequests.inc({ outcome: "unavailable", prompt_type: input.promptType });
    throw Errors.serviceUnavailable(FRIENDLY_AI_UNAVAILABLE);
  }

  aiRequests.inc({ outcome: "answered", prompt_type: input.promptType });
  // Only a successful call reaches this point: its tokens are what the store's AI actually cost (Part B).
  if (!platformPays) await recordTokens(input.tenantId, result.inputTokens, result.outputTokens).catch((err: Error) => logger.error({ err: err.message, tenantId: input.tenantId }, "AI usage count failed"));

  if (cacheKey) {
    await getRedis()
      .set(cacheKey, JSON.stringify(result), "EX", env.ai.cacheSeconds)
      .catch((err: Error) => logger.warn({ err: err.message }, "AI cache write failed"));
  }
  let released = false;
  const release = async () => {
    if (released || !source) return;
    released = true;
    await releaseQuota(input.tenantId, kind, source, month);
  };
  return { result, release };
}

/**
 * After a failed wait: what will happen to the job. "failed" and "removed" (it was still queued and
 * is taken off) mean no provider call; "running" means the worker has it, or has just finished it.
 */
async function abandonJob(job: Job): Promise<"failed" | "removed" | "running"> {
  try {
    const state = await job.getState();
    if (state === "failed") return "failed";
    if (state === "waiting" || state === "delayed" || state === "prioritized" || state === "waiting-children") {
      await job.remove();
      return "removed";
    }
    return "running";
  } catch {
    // Removal refused because the worker picked it up in the meantime, or the queue is unreachable:
    // treat it as running, so a finished answer is still charged.
    return "running";
  }
}

/** Charges a turn and records the tokens if an abandoned job finishes after all; a failure costs nothing. */
function chargeIfItFinishes(job: Job, events: QueueEvents, tenantId: string, kind: AiUsageKind, month: string): void {
  void job
    .waitUntilFinished(events, env.ai.jobTimeoutMs * 10)
    .then(async (raw: AiGenerateResult) => {
      await chargeLateAnswer(tenantId, kind, month);
      await recordTokens(tenantId, raw.inputTokens, raw.outputTokens, month);
    })
    .catch(() => undefined); // it failed, or never finished: nothing was produced, nothing is charged
}

/**
 * House style for everything the AI writes: no em dashes (the project's writing rule). The model
 * uses them freely, so every answer is tidied here, in the one place all AI features pass through,
 * rather than in each prompt. An em dash (U+2014), with or without spaces around it, becomes " - ".
 */
const EM_DASH = new RegExp(`[ \\t]*${String.fromCharCode(0x2014)}[ \\t]*`, "g");

export function tidyText(text: string): string {
  return text.replace(EM_DASH, " - ");
}
