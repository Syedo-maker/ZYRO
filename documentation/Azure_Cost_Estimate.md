# ZYRO on Azure: Cost Estimate

**Read this first.** These are estimates, worked out on 2026-10-21 from Azure's pay-as-you-go list
prices as known at that date, in US dollars, before tax. They were **not** checked against the live
price list: the development machine could not reach it reliably that day. Prices differ by region and
change over time. Before anything is provisioned, put the exact SKUs below into the Azure pricing
calculator (azure.microsoft.com/pricing/calculator) for the chosen region and replace these figures.

The template (`infra/`) is sized by one switch, `isProduction`. Everything below follows from it.

## Per month, by environment

| Service | Staging | Production | How it is charged |
|---|---|---|---|
| Container Apps (web, api, worker, reco) | about $15 to $30 | about $60 to $120 | Per vCPU-second and GiB-second; a lower rate while a replica is idle. The first 180,000 vCPU-seconds and 360,000 GiB-seconds a month are free per subscription. Staging lets web and api scale to zero; the worker and the recommendation service always keep one replica. |
| PostgreSQL Flexible Server | about $15 to $20 (B1ms, 32 GB) | about $35 to $50 (B2s, 64 GB, geo-redundant backups) | Compute per hour, plus storage per GB-month, plus backup storage beyond the server's size. |
| Azure Managed Redis | about $15 (Balanced B0) | about $50 to $60 (Balanced B1, high availability) | Per hour; high availability doubles the node count. **The least certain figure here**: the service is new and its prices were least settled at the time of writing. |
| MongoDB Atlas (billed by MongoDB, not Azure) | $0 (M0) | about $57 (M10) | M0 is free and shared, fine for staging and not for production (no backups, shared CPU). |
| Storage account | under $2 | under $5 at launch | Per GB stored and per operation; images and receipts are small. ZRS in production costs about a quarter more than LRS. |
| Container Registry (Basic) | about $5 | about $5 | Flat daily rate. |
| Log Analytics and Application Insights | $0 to $5 | about $5 to $25 | Per GB ingested after the first 5 GB a month. JSON logs from four apps; lower APPLICATIONINSIGHTS_SAMPLING_RATIO if this grows. |
| Key Vault | under $1 | under $1 | Per 10,000 operations; apps cache secrets. |
| **Total** | **about $50 to $80** | **about $210 to $320** | |

## Not included

- **Anthropic** (AI generations), **Stripe** fees, **SendGrid**: charged by use, by those companies.
  The AI cost per store is capped by the plan allowances in `backend/src/lib/plans.ts`.
- **A custom domain**: the domain itself is bought elsewhere; Container Apps' managed certificate
  for it is free.
- **Data leaving Azure** beyond the free allowance: small at launch (pages and API answers; product
  images are served by Blob Storage).
- **Support plans.**

## Where the money goes first, and what to change

1. **Redis and PostgreSQL** are the largest fixed costs in production. Both can start one size down
   (B0 and B1ms) for a soft launch and be raised with one parameter, no data migration.
2. **The recommendation service** keeps one warm replica (1 vCPU, 2 GiB) so the first shopper of the
   day does not wait for its models to load. If cost matters more than that first wait, set its
   minimum to zero in `infra/modules/apps.bicep`.
3. **Telemetry** grows with traffic. Sampling (`APPLICATIONINSIGHTS_SAMPLING_RATIO`) and 30-day
   retention are the levers.

## How the figures were reached

Container Apps: production assumes web and api at one replica each through the day, worker and
recommendation service mostly idle, and moderate active time; staging assumes mostly idle. The other
rows are the list price of the SKU named in `infra/main.bicep`, for one month. Ranges, not single
figures, because usage drives most of it.
