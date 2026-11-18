# Deploying the demo on Render and Vercel

This is the free-plan setup: the web app on Vercel, the API and its background jobs on Render, and
MongoDB on Atlas. The Azure setup for a real launch is in `Deployment_Runbook.md`.

| Part | Where | Defined in |
|---|---|---|
| Web app | Vercel, Root Directory `frontend` | `frontend/vercel.json` |
| API and background jobs | Render web service `zyro-api` | `render.yaml` |
| PostgreSQL | Render Postgres `zyro-postgres` | `render.yaml` |
| Redis | Render Key Value `zyro-redis` | `render.yaml` |
| MongoDB | MongoDB Atlas free cluster | `MONGODB_URI` |

## How the two sites work together

The browser only talks to the Vercel address. Vercel forwards `/api/*` to Render, so the sign-in cookie
belongs to the web app's own site and stays `SameSite=Lax`. This also works in browsers that block
third-party cookies. Leave `VITE_API_URL` unset on Vercel.

`frontend/vercel.json` names `https://zyro-api.onrender.com`. If Render gives the service another
address, change it there (four places) before relying on the site.

Direct calls from the web app to the API are also supported, but are not the recommended setup: set
`VITE_API_URL` on Vercel, `COOKIE_SAME_SITE=none` on Render, and add the API address to `connect-src`
in `frontend/vercel.json`. Browsers that block third-party cookies will then sign people out on reload.

Stores are addressed by path: `/store/<store id>`. There are no store subdomains, so the free
`*.vercel.app` address is enough and needs no wildcard domain.

## Settings

Render creates `JWT_ACCESS_SECRET`, `COD_PHONE_PEPPER` and `METRICS_TOKEN` itself, and fills in
`DATABASE_URL` and `REDIS_URL`. Enter the rest once in the Render dashboard:

| Name | Value comes from | Needed |
|---|---|---|
| `MONGODB_URI` | Atlas connection string | Yes |
| `PUBLIC_URL` | The Render service's `https://` address | Yes |
| `CORS_ORIGIN` | The Vercel `https://` address, no trailing slash | Yes |
| `STOREFRONT_URL` | The same Vercel address | Yes |
| `STORAGE_DRIVER` | `azure` or `local`, see Storage below | Yes |
| `AZURE_STORAGE_CONNECTION_STRING` | Azure storage account, Access keys | With `azure` |
| `ANTHROPIC_API_KEY` | Anthropic console | For AI features |
| `EMAIL_PROVIDER`, `BREVO_API_KEY`, `BREVO_FROM_EMAIL` | Brevo | For email |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe, test mode only | For card payments |

Leaving an optional group empty switches that feature off with a clear message. The API refuses to
start only when a required setting is missing.

`TRUST_PROXY=2` assumes two proxies in front of the API (Vercel, then Render). Check it after the first
deployment: if the API sees a proxy's address as the visitor's, all visitors share one rate limit.

## Free-plan limits

These are the limits Render published when this was written. Check them again before relying on them.

- The API sleeps after 15 idle minutes and takes about a minute to wake. Open the site before a demo.
- Scheduled background jobs do not run while the API sleeps.
- Free PostgreSQL expires after 30 days and has no backups.
- Free Key Value is kept in memory only. A restart loses carts, queued jobs and rate-limit counters.
- The disk is temporary. See Storage below.
- There is no shell and no pre-deploy step, so migrations run in the start command.

## Storage

Use Azure Blob Storage if an Azure for Students account is available: set `STORAGE_DRIVER` to `azure`
and enter `AZURE_STORAGE_CONNECTION_STRING`. The storage account must allow public access to blobs,
because product pictures are public; receipts and voice notes stay in the private container. The API
creates both containers when it starts.

Otherwise set `STORAGE_DRIVER` to `local`. Files then live on the temporary disk and disappear when the
service restarts or wakes from sleep, including new product pictures and payment receipts. The app
says so next to every upload control. The seeded demo products are not affected, because their pictures
are served by the web app from `/demo-assets`.

## Demo data

The free plan has no shell, so run the seed once from your own computer, in `backend/`, with
`DATABASE_URL` set to Render's external database address, `MONGODB_URI` to Atlas, and `REDIS_URL` to any
Redis you can reach (a local one is fine, nothing is kept there):

```
DEMO_IMAGE_BASE_URL=https://<vercel address>/demo-assets npm run seed:demo
```

Set those values and a private `DEMO_PASSWORD` in your terminal, not in a file in the repository. The
seed refuses a hosted database without it. See `Demo_Data.md` for what it creates.

## Checking a deployment

```
cd frontend
WEB=https://<vercel address> DEMO_PASSWORD=<set in your terminal> node e2e/production-smoke.e2e.mjs
```

It walks through the product on a desktop and a phone screen, and creates a few `e2e-` accounts.
