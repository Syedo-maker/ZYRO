# Backend tests

Jest and Supertest. Run from `backend/`.

| Command | What runs |
|---|---|
| `npm test` | Everything below except the real-service suites (about a minute) |
| `npm test -- billing` | One suite, by file name |
| `npm run test:real` | Suites that call the real Anthropic API and Stripe test mode (see below) |
| `npm run typecheck:tests` | Typecheck the tests |
| `npx jest --coverage` | The same run with a coverage report. Thresholds in `jest.config.js` fail the run if coverage drops below the floors measured in Phase 7. |

## What is here

- `unit/`: pure logic, no database (plan rules, per-task model choice, the API contract against the wireframe table, tenant scoping of every table).
- `integration/`: the real Express app through Supertest, against the real Postgres, MongoDB and Redis. Each file runs one realistic scenario (register stores, sell, refund...) in `beforeAll`, and each named check along the way is its own Jest test, so a report says exactly which check failed and why; a check the scenario never reached fails too. External services are faked (Stripe, the AI provider, email), except `recommendations`, which starts the real Python service with its test embedder.
- `quota-concurrency` is Phase 7's load gate: it fires 60 callers at one quota row at once and requires the exact allowance to be granted and no more. It was checked against a deliberately broken guard, which granted 41 of 60 against a limit of 15, so the test is known to fail when the thing it protects is removed.
- `demo-landing` guards the one AI endpoint a stranger can reach (the landing page's demo): it watches a real store's quota counters across the whole scenario to prove a visitor can never spend a merchant's allowance, and checks the per-visitor cap, the cache, and what happens when the AI is down.
- Two integration files are driven by `openapi.yaml` rather than by a scenario, so they cannot go stale as routes are added: `contract-routes` calls every documented endpoint and requires the server to have it, and `role-enforcement` calls every one with no credentials and requires it to turn the caller away (a token endpoint with 401 or 403, a guest-session endpoint with anything but a 2xx). Both fail when the contract and the code drift apart, which is the point.
- `real/`: calls the real Anthropic API (a few cents) and Stripe **test mode** (no money). Never part of `npm test`. They fail, saying what is missing, when the keys are not in `backend/.env`.
- `helpers/`: `appFetch` routes a test's `fetch` calls for the app through Supertest in process (no port), and `checks` turns a scenario's named checks into Jest tests.

## Needs

PostgreSQL, MongoDB and Redis running, `backend/.env` filled in, and for `recommendations` the Python virtualenv in `recommendation-service/.venv`. Tests create throwaway stores and users and remove them; `npx tsx scripts/cleanup-test-data.ts` removes anything a crashed run left behind.
