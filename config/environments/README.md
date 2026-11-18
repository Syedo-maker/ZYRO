# Environment configuration

Zyro reads every setting from environment variables (12-factor); nothing environment-specific is in
the code. The complete list, with what each setting is for and whether it is required, is in each
service's `.env.example`:

- `backend/.env.example`: the API and the worker (same variables)
- `frontend/.env.example`: the web app (build-time, public values only)
- `recommendation-service/.env.example`: the Python service

The files here show only what differs between environments. Values are placeholders: real secrets
live in the environment or a secret store, never in the repository. Every secret may also be given as
`NAME_FILE=/path` (a mounted secret file). The backend checks all of it at startup and stops with a
list of the variable names that are missing or invalid.

| File | Used for |
|---|---|
| `development.env.example` | a developer's machine (`npm run dev`) |
| `test.env.example` | automated tests (`npm test`, CI) |
| `staging.env.example` | a production-like test environment |
| `production.env.example` | real stores and shoppers |
