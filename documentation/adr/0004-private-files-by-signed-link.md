# 0004: Receipts and voice notes are private files, reached only by expiring links

**Status:** Accepted, 2026-10-21.

## Context

Every upload used to go to one public folder on the API container's disk. That disk is discarded when
a container restarts, and a bank-transfer receipt (names, account numbers) was readable by anyone with
its address.

## Decision

Files go to Blob Storage through one interface (`backend/src/lib/storage.ts`): product images in a
public container, receipts and voice notes in a private one. The database stores a key for a private
file, never an address. Whoever may see it gets a signed, read-only link that expires in an hour,
signed with the API's managed identity (a user delegation SAS), so no storage key exists anywhere.

## Also decided

- An upload's type comes from its bytes, never from the name or type the client sent. (Trusting the
  name allowed a web page to be stored and served from the API's origin: stored cross-site
  scripting.)
- Every served file carries a sandboxing Content-Security-Policy.
- A receipt key names its store, and is accepted only by that store.
- Where browsers fetch files can differ from where the API reaches storage
  (`AZURE_STORAGE_PUBLIC_URL`), for the emulator now and a CDN later.

## Consequences

- A link copied out of the dashboard stops working within the hour; the page fetches fresh ones.
- Existing files are moved with `scripts/move-private-uploads.ts`.
- The local driver mirrors the behaviour with HMAC-signed links, so development behaves like
  production.
