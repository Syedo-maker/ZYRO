# Phase 4, Module 6: AI Content Tools

Status: complete and verified (37 new backend checks in `verify-ai-content.ts`, 16 in `frontend/e2e/phase4-ai-content.e2e.mjs`; all other backend and browser suites still pass, 705 backend checks in total). Built on the AI Orchestrator from the previous session (provider adapter, BullMQ queue, quota system): no new AI infrastructure was added here, only prompt templates, thin endpoints, and the Admin Catalog UI that drives them, per the plan's own note that these tools "reuse the orchestrator and quota system... no new infrastructure, just new prompt templates and thin endpoints."

A `find-skill` search found nothing to install: the already-installed `claude-api` and `frontend-ui-engineering` skills cover this module's work (calling the orchestrator, wiring a React admin panel), and the feature itself is product-specific engineering, not something a packaged skill would provide.

## Two patterns, one rule: never silently overwrite merchant data

**Product descriptions** get a full draft lifecycle, reusing the `AiGeneratedContent` model and the four endpoints already stubbed in `openapi.yaml` from Phase 0: generate, edit the draft by hand, regenerate (keeping the last five superseded versions, oldest dropped first), and publish, which is the only step that ever touches the live `Product.description`. A new `GET /ai-description` was added (not in the original stub) so reopening a product can show its current draft without spending a generation just to see what is already there.

**Auto-tag and SEO metadata** are pure suggestions: `POST /auto-tag` and `POST /seo-metadata/generate` return a category/tag list or a meta title/description, and neither writes anything to the product. Applying one only fills the admin form's fields; the merchant still has to press Save. This is the simpler of the two patterns because there is nothing to draft, edit or publish, just a suggestion to accept or ignore.

**Review summaries** sit in between: not merchant content to edit, but not disposable either, so the result is cached on the product (`Product.reviewSummary`) rather than regenerated on every read. `GET /reviews/summary` is free (never calls the AI) and reports `stale: true` once 5 or more new published reviews have arrived since the cached summary was generated, so the admin UI can prompt for a refresh instead of silently spending quota on every page load.

## Structured replies without a structured-output API

Auto-tag and SEO metadata need two named fields back, not free text. Rather than extending the orchestrator's plain `{system, prompt} -> text` interface for a structured-output feature, the prompt itself asks for an exact two-line reply (`Category: ...\nTags: ...` / `Title: ...\nDescription: ...`) and a small parser matches it. A reply that does not follow the format is treated as a 503 (a retryable service failure), not silently saved as garbage; this still spends the quota reservation, the same as any other generation the orchestrator successfully ran, since the model did answer, using real tokens, even if this module could not use the answer.

## A real operational hazard found and fixed while testing: shared BullMQ queues

Confirming the fix caused no regression surfaced a genuine issue, not a test artifact: `e2e-server.ts` (the browser-test backend) and a plain verify script both call `startAiWorker()`, and BullMQ queues are a Redis-global resource, not a per-process one. Whichever process's worker happens to pick up a queued job is the one whose `AiProvider` answers it, so a verify script's own fake could be silently bypassed by an unrelated worker (a leftover `e2e-server.ts`, or even a real `npm run dev`) still running against the same Redis. Fixed by making the BullMQ queue name overridable (`AI_QUEUE_NAME`, `lib/aiQueue.ts`); the verify scripts now generate a unique name per run, the same way they already isolate their data with a throwaway tenant. A real deployment is unaffected: multiple real workers sharing one queue name is the intended way to scale, this only mattered because a test process installs its own fake in place of the real provider.

## Admin UI

A new `AiToolsPanel` (`frontend/src/pages/admin/AiToolsPanel.tsx`) is wired into the existing product edit form, shown only when editing an existing product (a suggestion needs a real product id): a quota line ("12 of 50 AI generations used this month"), the description draft with Edit/Regenerate/Publish and a draft/published badge, a review-summary section (hidden behind an explanatory line instead of a button that would just fail, when there are no published reviews yet), and the auto-tag/SEO-metadata suggestions with their own Apply buttons. The product form itself gained three new fields these tools can fill: Tags (comma-separated), Meta title and Meta description (named to avoid colliding with the existing Title/Description fields' accessible names, which real browser tests exercise). Quota-exhausted (402) responses surface as a plain message rather than a generic error.

## Verification

`backend/scripts/verify-ai-content.ts` (37 checks, fake provider, real Postgres/MongoDB/Redis/BullMQ): the full description lifecycle including the 5-entry history cap, auto-tag and SEO metadata parsing (both the well-formed and malformed-reply cases), review summarization and its staleness threshold, permission checks, tenant isolation, and quota exhaustion applying uniformly across all four tools. `frontend/e2e/phase4-ai-content.e2e.mjs` (16 checks, real Chromium, `e2e-server.ts`'s fake AI provider replying differently per tool based on its prompt) exercises the same flows through the actual admin UI: generate, hand-edit, regenerate, publish, both suggestion tools applying into the form and persisting on save, and the no-reviews-yet case.

## Deliberate limits

- No structured-output API feature: a strict-format prompt plus a small parser, as described above. Simpler, and sufficient for two short fields; revisit only if a prompt proves hard to keep in format.
- Auto-tag suggests one category as a plain string, matching the product's existing single-category field; it does not propose a change to the store's whole category taxonomy.
- The review-summary cache is invalidated by count only (5 new reviews), not by content; a summary is not automatically refreshed by, say, one dramatically negative new review arriving.
