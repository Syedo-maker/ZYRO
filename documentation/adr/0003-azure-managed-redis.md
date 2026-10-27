# 0003: Azure Managed Redis, single endpoint, no eviction

**Status:** Accepted, 2026-10-21.

## Context

Redis holds carts, rate-limit counters, the AI answer cache and the BullMQ job queues. Azure Cache for
Redis could no longer be created after 1 October 2026; its successor is Azure Managed Redis.

## Decision

Azure Managed Redis with the **EnterpriseCluster** clustering policy (one endpoint that behaves like a
single Redis) and **NoEviction**.

## Why

- BullMQ runs multi-key scripts. Under the OSS cluster policy keys are spread across shards and those
  scripts fail unless every key name is rewritten with hash tags.
- BullMQ requires that Redis never silently drops keys. A dropped key is a lost job: an order email
  never sent, an AI generation never finished. With no eviction, memory pressure becomes visible
  errors instead.

## Consequences

- The database must be sized for its peak, with headroom, and alerted on memory
  (Operations_Runbook.md).
- Development and CI use Redis 7, the major version Azure Managed Redis runs; the portable Redis 5 on
  the development machine is not representative and should be replaced.
