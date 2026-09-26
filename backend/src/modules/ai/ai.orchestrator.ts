import { createHash } from "node:crypto";
import { env } from "../../config/env";
import { Errors } from "../../errors/AppError";
import { getAiQueue, getAiQueueEvents, type AiJobData } from "../../lib/aiQueue";
import type { AiGenerateResult } from "../../lib/aiProvider";
import { modelFor } from "../../lib/aiModels";
import { getRedis } from "../../lib/redis";
import { reserveQuota, releaseQuota, quotaExhaustedError, type AiUsageKind } from "./ai.quota.service";

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
  const kind: AiUsageKind = input.kind ?? "generation";
  const model = modelFor(input.promptType);
  const maxTokens = input.maxTokens ?? 1024;

  // The cap covers the system text plus the caller's text; the caller's text is what gets cut
  // (the end of it: reviews are fed newest first, so the oldest go).
  const room = Math.max(1000, env.ai.maxPromptChars - input.system.length);
  const prompt = input.prompt.length > room ? input.prompt.slice(0, room) : input.prompt;

  const cacheKey =
    input.cache && env.ai.cacheSeconds > 0
      ? `ai:cache:${input.tenantId}:${createHash("sha256").update(JSON.stringify([input.promptType, model, input.system, prompt, maxTokens])).digest("hex")}`
      : undefined;
  if (cacheKey) {
    try {
      const hit = await getRedis().get(cacheKey);
      if (hit) return JSON.parse(hit) as AiGenerateResult;
    } catch (err) {
      console.error("AI cache read failed:", (err as Error).message); // a cache problem only costs a real call
    }
  }

  const source = await reserveQuota(input.tenantId, kind);
  if (!source) throw await quotaExhaustedError(input.tenantId, kind);

  const job = await getAiQueue().add(
    input.promptType,
    {
      tenantId: input.tenantId,
      promptType: input.promptType,
      model,
      system: input.system,
      prompt,
      maxTokens,
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
    result = await job.waitUntilFinished(getAiQueueEvents(), env.ai.jobTimeoutMs);
  } catch (err) {
    await releaseQuota(input.tenantId, kind, source); // give the reservation back, to where it came from; this attempt never happened
    // Whatever went wrong (missing key, the provider down, a timeout), this is the API
    // being unable to fulfil the request right now, not something the caller did wrong.
    throw Errors.serviceUnavailable(`AI generation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (cacheKey) {
    await getRedis()
      .set(cacheKey, JSON.stringify(result), "EX", env.ai.cacheSeconds)
      .catch((err: Error) => console.error("AI cache write failed:", err.message));
  }
  return result;
}
