# Phase 5, Module 3: AI Shopping Assistant

Status: complete and verified (20 new backend checks in `verify-assistant.ts`, 10 in `frontend/e2e/phase5-assistant.e2e.mjs`; all other backend and browser suites still pass, 725 backend checks in total). Only Module 3 and its own frontend widget were built this session, per the user's request; Module 7's remaining piece (Abandoned-Cart Recovery) and the AI business insights item are separate, not-yet-started Phase 5 work.

A `find-skill` search found nothing to install: `claude-api` and `frontend-ui-engineering` (already installed) cover this module's work, and the feature is product-specific engineering on top of the AI Orchestrator, not something a packaged skill would provide.

## What was already drafted

Two pieces of Phase 0 scaffolding already existed for this module, and the implementation follows both exactly rather than the simpler alternatives this session first reached for:

- `backend/openapi.yaml` already had `POST /stores/{storeId}/assistant/chat` stubbed, with a specific contract: the caller sends its own `conversationId` (not one the server mints), and `suggestedProducts` is a list of full `Product` objects.
- `backend/src/models/ChatTranscript.model.ts` already existed, with two decisions this session initially overwrote by editing the file without reading it first, then caught and restored: a `guestSessionId` field (a guest's conversation is identifiable too, not only a signed-in shopper's), and an `expiresAt` TTL index - the transcript is explicitly "a debugging aid, not a permanent record" of what a shopper said, so it expires (90 days after the last message, refreshed on every turn) rather than being kept forever. Both are back in place, and `verify-assistant.ts` checks for them.

## How a chat message is answered

1. **Identity.** The same middleware the cart already uses (`resolveCartOwner`): a bearer token for a signed-in shopper, or the `X-Guest-Session-Id` header for a guest. Buying does not need an account, and neither does asking the assistant a question.
2. **`conversationId` is minted and held by the caller**, the same trust-by-possession model already reviewed and accepted for the guest cart's session id: an unguessable id, generated with a CSPRNG on the frontend (`lib/assistantId.ts`, the same pattern as `lib/guestSession.ts`), is treated as proof enough that two requests belong to the same conversation. It is not bound to the shopper's identity.
3. **Relevant products, by keyword.** The shopper's message is run through the exact same Mongo text-index search built in Phase 3 (title/category/description, weighted, with the partial-word fallback) via `productService.list`. This is a deliberate scope choice named in the plan itself: "keyword-matched... rather than a full vector-embedding pipeline, which keeps scope realistic". Real semantic search is Phase 6's job (a separate Python embedding service, not built), which the plan already names as this search's future upgrade path.
4. **Short memory, long memory.** The last 6 exchanges are cached in Redis (`chat:ctx:{storeId}:{conversationId}`, an hour of inactivity expires it) purely to give the model conversational context; a fuller, but still temporary, log goes to `ChatTranscript` in MongoDB, for merchant review and debugging: capped at 200 messages per conversation so a very long chat cannot grow a document without bound, and expiring 90 days after its last message (refreshed on every turn) via a Mongo TTL index, since a transcript is a debugging aid, not a permanent record. These are deliberately two different things with two different lifetimes, per the plan's own wording ("cached in Redis, not persisted long-term" vs. "stored in Mongo... for later review").
5. **The reply.** The matched products (with their real prices and stock) are given to the model as the only facts it is allowed to answer from ("never invent a product, price or stock level that is not listed"), and the flattened conversation history plus the new message become the prompt. The orchestrator's `generate()` is a single-turn `{system, prompt} -> text` wrapper, not a full chat API, so history is flattened into the prompt as `Shopper: ...` / `Assistant: ...` lines rather than sent as a message array.
6. **Quota.** This is the first real use of the orchestrator's `chat` kind (built in Phase 4, never exercised by a feature until now): each message spends one of the store's monthly `chatMessagesUsed`, entirely separate from the `generationsUsed` the AI Content Tools spend. A store that has used up its chat quota gets a 402, surfaced by the widget as a plain, friendly message rather than a broken chat window.

## A real operational bug found and fixed along the way: BullMQ workers competing for the same queue

Confirming this module's tests didn't regress anything else surfaced the same class of problem flagged during Module 6's testing, but through a new symptom: this script's own fake `AiProvider` was being silently bypassed by an unrelated worker (a still-running `e2e-server.ts`, or a real `npm run dev`) listening on the same Redis-global BullMQ queue name. `verify-assistant.ts` now sets its own unique `AI_QUEUE_NAME` before importing anything, exactly like `verify-ai.ts` and `verify-ai-content.ts` already do.

## Rate limiting

A new limiter, `chatMessageLimiter` (`RATE_LIMIT_CHAT_MAX`, default 10/minute), keyed on the same identity as the cart (signed-in user or guest session id, not IP), sits in front of the endpoint: the monthly quota alone would not stop one shopper hammering the endpoint quickly within a single month's allowance. It reuses the same proven rate-limit factory every other limiter in this codebase is built from; its own correctness was not re-tested in `verify-security.ts`, a deliberate scope call given the underlying mechanism is already covered there by the very similar `reviewWriteLimiter`.

## Frontend: the widget

`AssistantWidget` (`frontend/src/components/storefront/AssistantWidget.tsx`) is mounted once, in `StorefrontLayout`, so it appears as a floating button on every storefront page (home, catalog, product, cart, account). Opening it shows a chat panel: a greeting, a scrollable message list, and, under an assistant reply, the suggested products as small clickable cards with a real image, title and price, linking straight to that product's page. A 402 (quota exhausted) or 429 (rate limited) response is shown as a plain in-chat message rather than a raw error.

The widget's own visible message list is deliberately kept in component state only, not re-fetched from a transcript endpoint on reload (no such endpoint was built; the plan does not ask for one) - a reload starts a visually fresh chat, though the assistant's own short-term memory on the backend is unaffected, since `conversationId` persists across the visit in `localStorage`.

## Verification

`backend/scripts/verify-assistant.ts` (20 checks, fake provider, real Postgres/MongoDB/Redis/BullMQ): keyword-matched suggestions (including a correctly-shown out-of-stock match), the prompt actually containing real product facts, conversation context carried within one conversationId and absent in a different one, chat-quota accounting kept separate from generation quota, guest transcripts recording a guest session id and signed-in ones recording a customer id (never both), the transcript's 90-day expiry being set, validation, tenant isolation, and quota exhaustion. `frontend/e2e/phase5-assistant.e2e.mjs` (10 checks, real Chromium): the widget present on more than one storefront page, a full ask-and-reply exchange with a real product suggestion card that navigates to the real product page, and a question matching nothing in the catalog correctly suggesting nothing.

## Deliberate limits

- Keyword search, not semantic search, for "relevant products" - explicitly named in the plan as this module's scope, with Phase 6 as the stated upgrade path.
- No admin UI to review chat transcripts, even though they are stored for that purpose; the plan does not ask for one in this module.
- The chat rate limiter's own mechanics were not independently re-tested, since it reuses an already-tested factory (see above).
