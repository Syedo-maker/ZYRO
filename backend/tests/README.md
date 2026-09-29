# Backend tests

Jest and Supertest. Run from `backend/`.

| Command | What runs |
|---|---|
| `npm test` | Everything below except the real-service suites (about a minute) |
| `npm test -- billing` | One suite, by file name |
| `npm run test:real` | Suites that call the real Anthropic API and Stripe test mode (see below) |
| `npm run typecheck:tests` | Typecheck the tests |

## What is here

- `unit/`: pure logic, no database (plan rules, per-task model choice, the API contract against the wireframe table, tenant scoping of every table).
- `integration/`: the real Express app through Supertest, against the real Postgres, MongoDB and Redis. Each file runs one realistic scenario (register stores, sell, refund...) in `beforeAll`, and each named check along the way is its own Jest test, so a report says exactly which check failed and why; a check the scenario never reached fails too. External services are faked (Stripe, the AI provider, email), except `recommendations`, which starts the real Python service with its test embedder.
- `real/`: calls the real Anthropic API (a few cents) and Stripe **test mode** (no money). Never part of `npm test`. They fail, saying what is missing, when the keys are not in `backend/.env`.
- `helpers/`: `appFetch` routes a test's `fetch` calls for the app through Supertest in process (no port), and `checks` turns a scenario's named checks into Jest tests.

## Needs

PostgreSQL, MongoDB and Redis running, `backend/.env` filled in, and for `recommendations` the Python virtualenv in `recommendation-service/.venv`. Tests create throwaway stores and users and remove them; `npx tsx scripts/cleanup-test-data.ts` removes anything a crashed run left behind.
