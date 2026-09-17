# Phase 0, Module 3: API Contract Draft

**Status:** Complete
**Deliverable:** `backend/openapi.yaml`, OpenAPI 3.1, validated (33 paths, 42 operations, no duplicate/missing `operationId`s).
**Built with:** the `writing-openapi-specs` skill (Speakeasy), found and installed via `find-skill`.

This satisfies Phase 0's exit criteria: "API contract draft (per-module endpoint list)." It consolidates every endpoint informally sketched per-phase in `Implementation_Plan.md` into one validated, consistently-conventioned contract, so Phase 1 onward has a single source of truth both students build against rather than re-deriving endpoint shapes from prose while coding.

## What changed versus the informal sketches in Implementation_Plan.md

A few things were tightened up while formalizing, since writing the actual contract surfaces gaps that a one-line sketch doesn't:

1. **Everything tenant-scoped moved under `/stores/{storeId}/...` consistently**, including cart and checkout, which the earlier phase-by-phase sketches left unprefixed. This wasn't decided yet when those sketches were written; it follows directly from the tenant-isolation model locked in during Module 1 (every query needs an explicit tenant filter), so the API surface should make that requirement visible too.
2. **`/products/search` was folded into `GET /stores/{storeId}/products` as a `q` query parameter** rather than a separate path: a search is a filtered list, not a distinct resource, and the OpenAPI conventions skill flags separate verb-like paths as an anti-pattern.
3. **Discount codes got a full CRUD set** (`discount_codes_list/create/update`) plus a separate `discount_codes_validate`. The plan mentioned creating codes and validating them at checkout, but not update/deactivate, which a merchant clearly needs (e.g. ending a promotion early).
4. **AI content tooling got a real path shape**: `POST .../ai-description/generate`, `PATCH .../ai-description`, `POST .../ai-description/regenerate`, `POST .../ai-description/publish`. The plan described the workflow (generate → edit/regenerate → publish) but not the endpoints; this maps it 1:1 onto the Mongoose `AiGeneratedContent` model from Module 1.
5. **Guest checkout got an explicit auth model.** Section 6 of the scope document requires checkout to work without an account, so cart/checkout/discount-validation/assistant-chat endpoints declare `security: [{bearerAuth}, {guestSession}]`, either a JWT or an opaque guest session id header is accepted, rather than silently assuming a logged-in customer.

## Conventions applied (per the `writing-openapi-specs` skill)

- `operationId` follows `resource_action` (`products_list`, `orders_status_update`, `ai_content_publish`), never auto-generated names.
- Component schemas are PascalCase (`ProductReview`, `AiUsageQuota`); tags are lowercase-hyphenated (`ai-content`, `ai-assistant`).
- Errors are RFC 7807 problem details (`application/problem+json`, a shared `Error` schema with a stable `type` URI), not ad hoc `{error: string}` shapes, so there's one error shape for both students to handle in the frontend, once.
- `examples` (plural) used over `example` throughout, per the skill's SDK-generation guidance.
- Reusable pieces (`StoreId`/`ProductId`/`Limit`/`Offset` parameters; `NotFound`/`Forbidden` responses; every schema) live in `components/`; one-off request bodies stay inline.

## Notable design decisions baked into the contract

- **`checkout_session_create` does not create an `Order`.** Per Phase 2 of the implementation plan, only the Stripe webhook (`webhooks_stripe_handle`) does that, on `checkout.session.completed`. The contract's description field says this explicitly on both operations so nobody implements order-creation on the client-redirect path by mistake.
- **AI quota errors are a distinct, shared shape** (`402 Payment Required` with the `Error` schema) reused identically by `ai_content_generate`, `ai_content_regenerate`, and `assistant_chat_send`, reflecting that all three draw from the same per-tenant monthly quota (Module 1's `AiUsageQuota` table).
- **`Product.aiDescriptionStatus`** is nullable (`draft` / `published` / `null`) rather than a boolean, so the frontend can render three real states (no AI content yet / drafted, unpublished / live) instead of inferring the "drafted but unpublished" state indirectly.

## Validation

Checked with `@apidevtools/swagger-parser` (installed temporarily, not part of the repo): full `$ref` resolution, spec-compliance validation, and a uniqueness check across all `operationId`s. All 33 paths / 42 operations passed with no errors.
