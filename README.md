# ZYRO

> **ZYRO is the product name for ShopMind AI** — a free, AI-native, multi-tenant e-commerce
> platform for small businesses, developed as a Final Year Project at Shifa Tameer-e-Millat
> University. This repository is where all implementation work for the project lives.

## Project

- **Muhammad Ibrahim** — BSAI-23F-0048
- **Syed Sikander Gillani** — BSAI-23F-0062
- **Supervisor:** Mr. Saad Ilyas
- Bachelor of Science in Artificial Intelligence

## What this is

ZYRO lets any merchant launch an online store with built-in AI-generated product content
and an AI shopping assistant, without paying for separate third-party apps — see
`documentation/` for the full scope and implementation plan.

## Repository layout

```
documentation/   Scope document, implementation plan, and per-module design docs
backend/         Node.js/Express API — Prisma (PostgreSQL) + Mongoose (MongoDB) schemas,
                 business logic, AI orchestrator (added phase by phase)
frontend/        React storefront + admin dashboard (added starting Phase 1)
```

## Development process

Work proceeds phase by phase against `documentation/Implementation_Plan.md`, one module
completed per session. Each completed module is committed and pushed here, with the
plan's checklist (Section 0) updated to reflect progress.

## Tech stack

React · TypeScript · Node.js/Express · PostgreSQL (Prisma) · MongoDB (Mongoose) ·
Redis + BullMQ · Stripe API · JWT · Tailwind CSS · Docker

See `documentation/Implementation_Plan.md` for the full architecture and per-module
technical decisions.
