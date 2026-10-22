# ZYRO: Operations Runbook

What to watch once ZYRO is live, and what to do when something goes wrong. Getting it deployed is
`Deployment_Runbook.md`; how it fits together is `Architecture.md`.

---

## Where to look

| Question | Where |
|---|---|
| Is the site up? | `https://<site>/healthz` (the web container) and `https://<site>/api/v1/plans` (through to the API) |
| Is a part unhealthy? | Container app > Revisions: health state per revision. The API's readiness checks PostgreSQL, MongoDB, Redis and storage, and names any that fails |
| What happened to one request? | Every response has an `X-Request-Id` (also in the body of an unexpected `500`). Search for it in Log Analytics (below) |
| Errors and slow calls | Application Insights > Failures, and > Performance, split by `zyro-api` and `zyro-worker` |
| What did the platform do? | `ContainerAppSystemLogs` (restarts, scaling, probe failures) |

### Useful queries (Log Analytics)

The table names depend on the environment's log destination: `ContainerAppConsoleLogs_CL` with a
`Log_s` column for Log Analytics; `ContainerAppConsoleLogs` with `Log` for Azure Monitor.

```kusto
// One request, everywhere it went
ContainerAppConsoleLogs_CL
| where Log_s has "<request id>"
| project TimeGenerated, ContainerAppName_s, Log_s
| order by TimeGenerated asc

// Errors in the last hour, by app
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(1h) and (Log_s has '"level":"error"' or Log_s has '"level":"fatal"')
| summarize count() by ContainerAppName_s, bin(TimeGenerated, 5m)

// Requests that hit the 90-second backstop
ContainerAppConsoleLogs_CL
| where Log_s has "request timed out"

// A dependency failing readiness
ContainerAppConsoleLogs_CL
| where Log_s has "readiness check failed"
| extend dependency = extract('"dependency":"([^"]+)"', 1, Log_s)
| summarize count() by dependency, bin(TimeGenerated, 5m)
```

## Alerts to set up before launch

| Alert | On | Why |
|---|---|---|
| Site down | an availability test on `/healthz` and `/api/v1/plans` failing from two locations | The first thing merchants notice |
| Error rate | API `5xx` above 2% for 5 minutes | Something is broken for many people at once |
| Replicas restarting | `RestartCount` increasing on any app | A crash loop |
| Redis memory | above 80% | Redis never evicts (adr/0003); full means errors |
| PostgreSQL storage | above 80% | Auto-grow is on, but storage only grows |
| AI queue backlog | the worker at its maximum replicas for 15 minutes | AI features are slowing down for everyone |

## When something goes wrong

### A release broke something

The release script rolls back by itself when the new revisions fail their health checks or the
smoke test. If a problem shows up later:

```sh
az containerapp revision list -n <api app> -g <resource group> -o table     # find the previous revision
az containerapp ingress traffic set -n <api app> -g <resource group> --revision-weight <previous>=100
az containerapp ingress traffic set -n <web app> -g <resource group> --revision-weight <previous>=100
```

Traffic moves in seconds; nothing is rebuilt. Then fix forward through the normal pipeline. A
migration is never rolled back by hand; migrations are written to be backward compatible (adr/0007).

### The API says "not ready"

Its readiness names the failing dependency. While one is down, the API takes no traffic rather than
answering half-broken requests; it recovers by itself when the dependency returns (tested in Phase 3).

| Dependency | First check |
|---|---|
| PostgreSQL | Server status in the portal; connections not exhausted; firewall still admits Azure services |
| MongoDB | Atlas cluster status; Atlas network access still allows Azure |
| Redis | Memory (no eviction: full means errors); the access key not rotated without updating Key Vault |
| Storage | The managed identity still has Storage Blob Data Contributor |

### AI features answer 503

Expected, and safe: the store's AI allowance is not charged for a failed attempt. Check the Anthropic
status page and the `anthropic-api-key` secret. Everything else keeps working.

### Payments are not becoming orders

Card payments become orders only through Stripe's webhook. In the Stripe dashboard, check the
endpoint (`https://<site>/api/v1/webhooks/stripe`) for failed deliveries; a wrong signing secret shows
as `400`s. Stripe retries for three days, so fixing the secret recovers them.

## Routine work

### Rotating a secret

1. Create the new value where it comes from (Stripe, Anthropic, Atlas, or generate one).
2. `az keyvault secret set --vault-name <vault> --name <secret> --value <new>`.
3. Restart the revision so it reads the new value:
   `az containerapp revision restart -n <app> -g <resource group> --revision <active revision>`.
4. Revoke the old value at its source.

Rotating `jwt-access-secret` signs everyone out (their next page load signs them in again if their
refresh cookie is still valid).

### Turning on email (abandoned-cart reminders)

Email is off until the provider's settings are all set. While it is off:
- no reminder is written, so no store's AI allowance is spent;
- each scan logs one warning that names the missing settings (never their values);
- every store's Marketing page says "Email sending is not set up".

- **Locally:** put the provider's settings in `backend/.env` (names in `backend/.env.example`; the
  file is read by path, and is never committed). Restart the backend.
  - SendGrid (the default): `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL`.
  - Brevo: `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY` (the API key, not the SMTP key) and
    `BREVO_FROM_EMAIL`, plus `BREVO_FROM_NAME` if you want a name other than ZYRO.
- **Azure:** set `ZYRO_SENDGRID_API_KEY` and `ZYRO_SENDGRID_FROM_EMAIL` in the azd environment and run
  `azd provision`. The key goes into Key Vault, and the apps read it as an environment variable.

The from address must be a verified sender in that provider's account, or every send is refused.
A free-mail address (Gmail and the like) works for testing but tends to land in spam; for a launch,
authenticate a domain you own with the provider and send from an address on it. A refused
or failed send gives the store's AI generation back, and the next scan tries again.

Another provider is one adapter in `backend/src/lib/email.*.ts` and one entry in `lib/email.ts`,
chosen with `EMAIL_PROVIDER`; no feature changes.

### Changing what staff may do

Roles are defined in `backend/src/lib/staffRoles.ts`:
- **Cashier:** the register.
- **Manager:** the register, refunds, discounts, analytics and orders, plus the catalogue: products,
  stock, categories and the AI tools, which draw on the store's own allowance.

Billing, the team, plans and AI packs, and store settings stay with the owner. The owner changes a
member's role on the Team page. When a role gains a permission, existing staff keep their old list
until a script like `scripts/migrate-manager-products.ts` moves them: it reports first and changes
nothing without `--apply`.

### Restoring the database

PostgreSQL keeps point-in-time backups (7 days on staging, 14 on production). A restore creates a
**new** server from a moment you choose; point `database-url` in Key Vault at it and restart the
apps. Atlas backups are restored from the Atlas console the same way.

### Scaling

Every size is a parameter in `infra/main.bicep` (replica limits in `infra/modules/apps.bicep`). Change
it, run `azd provision`. Raising PostgreSQL or Redis tiers needs no data migration.

### Moving old uploads

On an environment created before private storage existed:
`npx tsx scripts/move-private-uploads.ts` reports, `--apply` moves. Safe to run twice.

## Before every production release (the reviewer's checklist)

- [ ] It ran on staging, and the release there finished without a rollback.
- [ ] Any migration only adds (columns, tables, indexes); nothing is removed or renamed in the same
      release that stops using it.
- [ ] Anything that changes what merchants or shoppers are told (prices, the Terms, the Privacy
      Policy) has been read by the owners.
