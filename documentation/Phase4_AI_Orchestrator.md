# Phase 4: AI Orchestrator

Status: complete and verified (16 new backend checks in `verify-ai.ts`; all 11 backend suites still pass, 647 + 16 = 663 checks in total). This is infrastructure only: no merchant-facing AI feature is built yet. Module 6 (AI Content Tools: product descriptions, review summarization, auto-tagging, SEO metadata) and Module 3 (AI Shopping Assistant) are separate, not-yet-started plan items that will call the pieces built here; this module defines no prompt templates and no content-generating endpoint of its own.

A `find-skill` search for this module found no packaged skill that fit its actual shape (a provider adapter plus a job queue plus a quota system is ordinary application engineering, not a specialized domain); the already-installed `claude-api` skill covered the Anthropic SDK usage, and a new `bullmq-specialist` skill (from `agent-skills-hub/agent-skills-hub`, security-reviewed and installed with the user's confirmation) covered BullMQ patterns.

## What was already in place

Phase 0's schema design anticipated this module: `AiUsageQuota` (Postgres, keyed by `[tenantId, month]`) and `CartRecoveryEvent` were already migrated and already in the tenant-scoping allow-list (`lib/prisma.ts`), and `AiGeneratedContent` (MongoDB, one per product, capped 5-entry history) and `Product.aiDescriptionId` already existed for Module 6 to use later. None of that needed to change; this module only adds the pieces that were still missing.

## Provider adapter

`lib/aiProvider.ts` defines `AiProvider`, one method (`generate`), the same shape as `StripeGateway` in `lib/stripe.ts`: a real Anthropic implementation, lazily constructed and guarded on a missing `ANTHROPIC_API_KEY` (503, exactly like Stripe's missing-keys case), plus `setAiProvider`/`getAiProvider` so tests and the verify script substitute a fake instead of spending real API calls. The model is one environment variable (`AI_MODEL`, default `claude-opus-5`); short, structured content (a product description, a tag list, an SEO snippet) does not need the largest model, and changing it is a one-line config change that never touches quota accounting, which counts generations, not tokens.

## Job queue

`lib/aiQueue.ts` wraps BullMQ: a `Queue`, a `Worker` (started once, in the same process as the API, since Implementation_Plan.md has no separate worker deployment yet), and `QueueEvents` so a caller can `await` a job's result without polling. Every AI call is enqueued rather than awaited synchronously in a request handler, per the plan, which keeps a slow or overloaded LLM from tying up an Express request thread. Jobs retry up to 3 times with exponential backoff; a 4xx failure from Anthropic (other than 429) is treated as unrecoverable and skips the remaining retries, since a bad request or an invalid key will never succeed by trying again. BullMQ needs its own Redis connection with `maxRetriesPerRequest: null` (a hard BullMQ requirement for its blocking commands), so `lib/redis.ts` gained a second, separate connection alongside the existing cart/rate-limit one.

## Quota system

`modules/ai/ai.quota.service.ts` creates a tenant's `AiUsageQuota` row for the current month on first use, with the configured defaults (`AI_MONTHLY_GENERATIONS_LIMIT`, default 50; `AI_MONTHLY_CHAT_MESSAGES_LIMIT`, default 200), checks remaining quota, and increments the right counter. Generations and chat messages are tracked and limited separately, since the shopping assistant (Phase 5) is a different kind of usage from one-off content generation.

## The orchestrator itself

`modules/ai/ai.orchestrator.ts` exports one function, `generate(tenantId, promptType, ...)`, the single interface every future AI feature calls through, matching the plan's own description. Order of operations: quota is checked **before** the job is enqueued (so an exhausted tenant's call never reaches the provider or the queue), and the usage counter is only incremented **after** the job succeeds (so a failed generation never costs the tenant a turn they didn't get). A job failure of any kind (missing key, the provider down, a timeout) surfaces to the caller as 503, since from the merchant's side this is the API being unable to fulfil the request right now, not something they did wrong.

## What is exposed today

`GET /stores/:id/ai-usage` (owner, or staff with `products_write`, matching the permission Module 6 will require to spend the quota): returns the current month's usage and limits. This is the only new endpoint; it is also the only place this module's work is currently visible over HTTP, since there is no content-generation endpoint yet to drive it. `openapi.yaml` already had this endpoint and the `AiUsageQuota` schema stubbed from the Phase 0 contract draft; only its description and a 403 response were added.

## Verification

`backend/scripts/verify-ai.ts` (16 checks, fake provider, real Redis/BullMQ/Postgres): lazy quota creation with the tenant's defaults, permission checks (401/403) on the usage endpoint, a generation round-tripping through the real queue and worker, a failed generation (every retry exhausted) costing nothing, quota exhaustion refusing a call before it reaches the provider, generations and chat tracked as separate counters, and tenant isolation (a second store's quota is untouched by the first store's usage or exhaustion). `backend/scripts/verify-ai-real.ts` is a second, opt-in script that makes one real call to the Anthropic API through the real adapter; it is never run automatically (it costs real money) and was not run as part of this module's verification, since no Anthropic API key has been configured yet.

## Deliberate limits

- No prompt templates, no content-generation endpoint, no `AiGeneratedContent` writes: that is Module 6.
- No admin UI for AI usage: the plan wires a quota display into the Admin Catalog UI as part of Module 6's frontend item.
- The worker runs in the same process as the API (matches the rest of this codebase, which has no separate worker deployment); splitting it into its own process is a config change to `lib/aiQueue.ts`'s caller, not a redesign, if that is ever needed.
- Only an Anthropic adapter exists. The plan names OpenAI/Anthropic together; the `AiProvider` interface is the seam a second adapter would implement, but none is built since only one is needed so far.
