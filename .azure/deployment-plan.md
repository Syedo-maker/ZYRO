# Azure Deployment Plan

> **Status:** Ready for Validation (templates compiled; nothing provisioned; deployment waits for the owners' go-ahead)

Generated: 2026-10-21

---

## 1. Project Overview

**Goal:** Run ZYRO, a multi-tenant commerce, point-of-sale and AI SaaS for small businesses in
Pakistan, on Microsoft Azure as a real product: a staging environment that every change reaches
first, and a production environment that a person promotes it to.

**Path:** Modernize Existing (the application exists; this adds containers, infrastructure and a
release pipeline).

---

## 2. Requirements

| Attribute | Value |
|-----------|-------|
| Classification | Production |
| Scale | Small (launch), built to scale out |
| Budget | Cost-optimized: smallest SKUs that meet the requirements, raised per environment by parameter |
| **Subscription** | Not chosen yet. Confirmed with the owners at deployment time, not before. |
| **Location** | Not chosen yet. Recommended: UAE North (nearest Azure region to Pakistan); Central India as the alternative. Every service used must be available there; checked at deployment time. |

Approved by the owners on 2026-10-20 as part of the production-readiness plan (Production_Readiness.md):
MongoDB Atlas on Azure (not Cosmos DB), two environments (staging and production), merchants' own
colours on storefronts. **Nothing is created in Azure until the owners say so.**

---

## 3. Components Detected

| Component | Type | Technology | Path |
|-----------|------|------------|------|
| web | Frontend | React 19, Vite, served by nginx, which also forwards `/api` to the API | `frontend/` |
| api | API | Node 24, Express, Prisma (PostgreSQL), Mongoose (MongoDB) | `backend/` (`dist/index.js`) |
| worker | Worker | Same image as api: BullMQ workers on Redis | `backend/` (`dist/worker.js`) |
| migrate | Job | Same source, `migrate` image target: `prisma migrate deploy` | `backend/` |
| reco | Internal API | Python 3.11, FastAPI, fastembed, faster-whisper | `recommendation-service/` |

---

## 4. Recipe Selection

**Selected:** AZD with Bicep.

**Rationale:** `azd provision` creates or updates an environment from `infra/` in one command, and
`azd env` keeps staging and production apart. Day-to-day releases do not go through `azd`: they go
through GitHub Actions (`.github/workflows/deploy.yml`), which needs revision-level control for
blue-green releases and rollback.

**Module choice.** The templates use Azure resources directly rather than Azure Verified Modules.
AVM modules are fetched from a registry and pinned by exact version; at the time of writing that
registry could not be reached reliably from the development machine to check versions and
parameters, and every template here was compiled with the Bicep CLI (0.48.1) instead. Moving to AVM
modules later changes no resource.

---

## 5. Architecture

**Stack:** Containers (Azure Container Apps).

### Why the frontend is a container, not Static Web Apps

The plan of 2026-10-20 named Static Web Apps. It was changed while writing these templates: the
login refresh token is an `httpOnly`, `SameSite=lax` cookie on the API's origin. If the site and the
API lived on different domains (a Static Web Apps host and a Container Apps host), the browser would
not send that cookie, and merchants would be signed out on every reload. The site and the API must
share one origin. The `web` container serves the built site and forwards `/api/*` to the API over
the environment's private network, the same arrangement as the Vite dev server's proxy. Two further
gains: the API has no public address of its own, and nginx's proxy timeout is set to outlast the
API's longest legitimate wait (a 60-second AI generation).

### Service Mapping

| Component | Azure Service | Staging | Production |
|-----------|---------------|---------|------------|
| web | Container Apps (external ingress, port 8080) | 0.25 vCPU, 0.5 GiB, 0 to 2 replicas | 0.25 vCPU, 0.5 GiB, 1 to 4 replicas |
| api | Container Apps (internal ingress, port 5000, multiple revisions) | 0.5 vCPU, 1 GiB, 0 to 2 | 0.5 vCPU, 1 GiB, 1 to 6 |
| worker | Container Apps (no ingress) | 0.5 vCPU, 1 GiB, 1 | 0.5 vCPU, 1 GiB, 1 to 4, scaled on the AI queue's length |
| reco | Container Apps (internal ingress, port 8001) | 1 vCPU, 2 GiB, 1 | 1 vCPU, 2 GiB, 1 to 2 |
| migrate | Container Apps job (manual trigger, run by the pipeline before each release) | 0.25 vCPU | 0.25 vCPU |
| PostgreSQL | Azure Database for PostgreSQL Flexible Server 17 | Burstable B1ms, 32 GB | Burstable B2s, 64 GB, 14-day backups, geo-redundant backups |
| MongoDB | MongoDB Atlas, in the same Azure region (outside this template) | M0/M10 | M10 or above |
| Redis | Azure Managed Redis (Balanced B0), TLS, no eviction (BullMQ needs it) | B0 | B1, high availability |
| Files | Storage account: `public` container (product images), `private` container (receipts, voice notes) | LRS | ZRS |
| Images | Azure Container Registry | Basic | Basic (one registry per environment) |

### Supporting Services

| Service | Purpose |
|---------|---------|
| Log Analytics | Container logs (JSON lines) and platform events |
| Application Insights | Requests, dependencies and exceptions from api and worker (OpenTelemetry) |
| Key Vault | Every secret; apps read them through Key Vault references |
| Managed Identity | Two user-assigned identities: `app` (web, api, worker, migrate) and `reco`; no keys in configuration |

Azure Cache for Redis is not used: it could no longer be created after 1 October 2026.

---

## 6. Provisioning Limit Checklist

### Phase 1: Resource inventory (per environment)

| Resource Type | Number to Deploy | Total After Deployment | Limit/Quota | Notes |
|---------------|------------------|------------------------|-------------|-------|
| Microsoft.Resources/resourceGroups | 1 | At deployment | At deployment | |
| Microsoft.ManagedIdentity/userAssignedIdentities | 2 | At deployment | At deployment | |
| Microsoft.OperationalInsights/workspaces | 1 | At deployment | At deployment | |
| Microsoft.Insights/components | 1 | At deployment | At deployment | |
| Microsoft.KeyVault/vaults | 1 | At deployment | At deployment | |
| Microsoft.ContainerRegistry/registries (Basic) | 1 | At deployment | At deployment | |
| Microsoft.Storage/storageAccounts | 1 | At deployment | At deployment | |
| Microsoft.DBforPostgreSQL/flexibleServers | 1 | At deployment | At deployment | Burstable vCPU quota per region |
| Microsoft.Cache/redisEnterprise | 1 | At deployment | At deployment | Azure Managed Redis region availability |
| Microsoft.App/managedEnvironments | 1 | At deployment | At deployment | |
| Microsoft.App/containerApps | 4 | At deployment | At deployment | Consumption cores per environment |
| Microsoft.App/jobs | 1 | At deployment | At deployment | |

### Phase 2: Quotas

**Deferred to deployment.** Quotas belong to a subscription and a region, and neither has been
chosen. Before the first `azd provision`, the azure-quotas checks are run against the chosen
subscription and region and the table above is completed. This is the first step of the deployment
runbook (documentation/Deployment_Runbook.md).

---

## 7. Execution Checklist

- [x] Dockerfiles: `backend/Dockerfile` (runtime and migrate targets), `recommendation-service/Dockerfile`, `frontend/Dockerfile`
- [x] `azure.yaml`
- [x] `infra/main.bicep`, `infra/main.parameters.json`, `infra/modules/*.bicep`
- [x] Compiled with the Bicep CLI
- [x] GitHub Actions: `ci.yml` (every push and pull request), `deploy.yml` (staging on main, production on approval, blue-green with rollback)
- [x] Cost estimate (documentation/Azure_Cost_Estimate.md)
- [ ] Owners choose subscription and region
- [ ] Quota checks (Phase 2 above)
- [ ] MongoDB Atlas cluster created in the same region, connection string added to the environment
- [ ] `azd provision` for staging, then production
- [ ] GitHub environment secrets and federated credentials (runbook)
