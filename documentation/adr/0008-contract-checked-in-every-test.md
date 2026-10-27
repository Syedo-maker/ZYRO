# 0008: The API contract is checked in every test, in both directions

**Status:** Accepted, 2026-10-21.

## Context

`backend/openapi.yaml` is the contract the web app, the register and any integrator are written
against. It was checked only for routes existing. Nothing checked that responses had the documented
shape, or that the web app called only documented endpoints.

## Decision

Three checks that hold each other in place:

1. **Every documented operation exists in the server** (`contract-routes.test.ts`).
2. **Every JSON response, in every integration test, matches the contract**
   (`tests/helpers/conformance.ts`, a Jest setup file): successes documented and matching, errors as
   problem documents.
3. **Every call the web app makes is a documented operation** (`tests/unit/ui-contract.test.ts`,
   reading the frontend's source with the TypeScript compiler).

## Why

It runs on the 1,700+ requests the suite already makes, across every module, so the contract is
checked against real scenarios rather than samples written for the purpose. Its first run found 24
violations, every one a place where a client generated from the contract would have crashed.

## Consequences

- Changing a response means changing the contract in the same commit, or the suite fails.
- New fields must be documented; nullable fields must say so.
