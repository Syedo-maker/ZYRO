import { env } from "../../config/env";
import { Errors } from "../../errors/AppError";
import { getAiQueue, getAiQueueEvents, type AiJobData } from "../../lib/aiQueue";
import type { AiGenerateResult } from "../../lib/aiProvider";
import { reserveQuota, releaseQuota, quotaExhaustedMessage, type AiUsageKind } from "./ai.quota.service";

export interface GenerateInput {
  tenantId: string;
  /** Names the prompt template a future module uses (e.g. "product_description",
   *  "review_summary", "auto_tag", "seo_metadata", "chat"). Carried through to the job for
   *  logging; this module defines no prompt templates itself. */
  promptType: string;
  /** Which quota counter this call draws from. Everything except the shopping assistant
   *  (Phase 5, Module 3) is a "generation"; only its chat turns are "chat". */
  kind?: AiUsageKind;
  system: string;
  prompt: string;
  maxTokens?: number;
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
 */
export async function generate(input: GenerateInput): Promise<AiGenerateResult> {
  const kind: AiUsageKind = input.kind ?? "generation";
  if (!(await reserveQuota(input.tenantId, kind))) {
    throw Errors.quotaExhausted(await quotaExhaustedMessage(input.tenantId, kind));
  }

  const job = await getAiQueue().add(
    input.promptType,
    {
      tenantId: input.tenantId,
      promptType: input.promptType,
      system: input.system,
      prompt: input.prompt,
      maxTokens: input.maxTokens ?? 1024,
    } satisfies AiJobData,
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    }
  );

  try {
    return await job.waitUntilFinished(getAiQueueEvents(), env.ai.jobTimeoutMs);
  } catch (err) {
    await releaseQuota(input.tenantId, kind); // give the reservation back; this attempt never happened
    // Whatever went wrong (missing key, the provider down, a timeout), this is the API
    // being unable to fulfil the request right now, not something the caller did wrong.
    throw Errors.serviceUnavailable(`AI generation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
