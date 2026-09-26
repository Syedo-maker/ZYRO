import { env } from "../config/env";

/**
 * Which model answers which kind of request (Part A cost controls: "cheaper models for simple
 * tasks"). Two tiers, priced per million tokens as of 2026-09 (input / output):
 *   fast     claude-haiku-4-5   $1 / $5   short structured outputs and chat replies
 *   standard claude-sonnet-5    $2 / $10  writing a merchant will publish or send to shoppers
 * The largest model is not used by default: none of these tasks needs it, and it would cost
 * roughly two to three times as much per call (claude-opus-5 is $5 / $25). The plan prices in
 * lib/plans.ts assume these two tiers.
 */
export type ModelTier = "fast" | "standard";

const TIER_BY_PROMPT: Record<string, ModelTier> = {
  // A category and tags, a meta title, a chat reply: short, constrained, tolerant of a smaller model.
  auto_tag: "fast",
  seo_metadata: "fast",
  chat: "fast",
  // Customer-visible or merchant-published writing: the better model.
  product_description: "standard",
  review_summary: "standard",
  marketing_copy: "standard",
  business_insights: "standard",
  cart_recovery: "standard",
};

/** An unknown prompt type gets the standard model: quality first, so a new feature is never quietly given a weak one. */
export const tierFor = (promptType: string): ModelTier => TIER_BY_PROMPT[promptType] ?? "standard";

export const modelFor = (promptType: string): string => env.ai.models[tierFor(promptType)];

/**
 * How to ask a model for a short, direct answer without paying for reasoning it does not need.
 * Haiku and Sonnet take thinking switched off; Opus-class models take a low reasoning effort
 * instead (switching thinking off there can leak the reasoning into the reply). Any other model
 * gets no extra parameters, which every current model accepts.
 */
export function directAnswerParams(model: string): { thinking?: { type: "disabled" }; output_config?: { effort: "low" } } {
  if (/haiku|sonnet/.test(model)) return { thinking: { type: "disabled" } };
  if (/opus/.test(model)) return { output_config: { effort: "low" } };
  return {};
}
