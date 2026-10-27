# 0002: MongoDB Atlas on Azure, not Cosmos DB for MongoDB

**Status:** Accepted, 2026-10-20 (the owners' decision).

## Context

The catalogue, reviews and embeddings are in MongoDB, and product search uses a weighted text index.
Azure offers Cosmos DB for MongoDB (vCore), which speaks the MongoDB protocol; MongoDB Atlas also runs
inside Azure regions.

## Decision

MongoDB Atlas, in the same Azure region as the rest of ZYRO.

## Why

Cosmos DB vCore supports text indexes, but they are case-sensitive, so "Cup" and "cup" would match
different products: product search would silently return different results from the ones every test
has proved. Atlas is MongoDB itself, so behaviour matches development exactly.

## Consequences

- One more vendor, billed separately, configured outside the Bicep template (its connection string
  goes into Key Vault).
- Atlas must allow connections from Azure; private networking to it is a later step.
