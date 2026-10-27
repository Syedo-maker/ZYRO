# 0005: Background workers run in their own process

**Status:** Accepted, 2026-10-21.

## Context

AI generations, the abandoned-cart scan and the weekly Growth Advisor and Trend Scout jobs ran inside
the API process.

## Decision

A separate entry point, `backend/src/worker.ts`, from the same image. In production it is its own
container app, scaled on the length of the AI queue; on a developer's machine the workers still run
inside the API, so one command starts everything.

## Why

- A burst of AI work no longer competes with shoppers' requests for the same CPU.
- Each scales on its own signal: the API on requests, the worker on queued jobs.
- A stuck job cannot hold up an API release, and an API release does not cut a job short (both shut
  down gracefully, finishing what they started).

## Consequences

- One more container that must always run (at least one replica, for the schedules).
- Schedules are registered under fixed ids, so two replicas starting together still produce one run
  per period.
