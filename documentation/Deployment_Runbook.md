# ZYRO: Deployment Runbook

How ZYRO goes from this repository to Azure, in order. **Nothing here has been run.** Every step
that creates something in Azure, or costs money, waits for the owners to say go.

The decisions behind the infrastructure are in `.azure/deployment-plan.md`; the costs in
`Azure_Cost_Estimate.md`; how to run it day to day in `Operations_Runbook.md`.

---

## 0. What you need

- The **Azure CLI** and the **Azure Developer CLI (azd)**, signed in (`az login`, `azd auth login`).
- An Azure **subscription** you may create resource groups in, and the **region** chosen. UAE North
  is the nearest to Pakistan; check every service below is offered there.
- A **MongoDB Atlas** account.
- **Owner** access to the GitHub repository, to set environments and variables.

## 1. Check quotas in the chosen region

Before the first provision, for each resource type in `.azure/deployment-plan.md` section 6:

```sh
az quota usage list --scope /subscriptions/<subscription-id>/providers/Microsoft.App/locations/<region>
```

and the same for `Microsoft.DBforPostgreSQL` and `Microsoft.Cache`. Complete the table in the
plan. A region without Azure Managed Redis or PostgreSQL Flexible Server capacity is the wrong region.

## 2. MongoDB Atlas

Create a cluster **on Azure, in the same region** (M0 for staging, M10 or above for production).
Create a database user with access to the `zyro` database only, and allow access from Azure (Atlas
network access). Copy the `mongodb+srv://` connection string; it goes into step 3.

## 3. Create an environment

Staging first. Every secret is generated fresh for each environment, never copied between them,
never committed:

```sh
azd env new zyro-staging
azd env set AZURE_LOCATION uaenorth
azd env set ZYRO_POSTGRES_ADMIN_PASSWORD "$(openssl rand -hex 24)"
azd env set ZYRO_JWT_ACCESS_SECRET "$(openssl rand -base64 48)"
azd env set ZYRO_RECOMMENDATION_SERVICE_TOKEN "$(openssl rand -hex 32)"
azd env set ZYRO_MONGODB_URI "mongodb+srv://..."
# Optional integrations; each is wired in only when set:
azd env set ZYRO_STRIPE_SECRET_KEY "rk_test_..."      # test keys on staging
azd env set ZYRO_STRIPE_WEBHOOK_SECRET "whsec_..."    # from step 8
azd env set ZYRO_ANTHROPIC_API_KEY "sk-ant-..."
```

For production, `azd env new zyro-prod`, the same steps with **live** keys, and
`azd env set ZYRO_PRODUCTION true`.

The values live in `.azure/<environment>/.env` on your machine (ignored by Git) and in Key Vault once
provisioned. Keep a copy in your password manager: the Postgres password cannot be read back out of
Azure, only reset.

## 4. Provision, then deploy, then provision once more

```sh
azd provision     # creates everything; the apps start on a public placeholder image
azd deploy        # builds the four images, pushes them, runs migrations (predeploy hook), updates the apps
azd provision     # once: now that real images exist, sets the real ports and health probes
```

The second provision is needed only the first time: until an image exists, each app runs a
placeholder on port 80 with no probes, and `azd deploy` changes only the image.

Then open the `SITE_URL` that `azd env get-values` prints. The site, sign-up and a storefront should
work end to end.

## 5. Check the visitor address (rate limits depend on it)

Three proxies stand between a visitor and the API, and `TRUST_PROXY=3` tells it so. If that number
is wrong, every visitor shares one address and the rate limits block everyone at once.

From two different networks (a phone off Wi-Fi, and a laptop), sign in with a wrong password six
times from the first. The first is locked out; **the second must still be able to sign in.** If the
second is locked out too, the count is wrong: change `TRUST_PROXY` in `infra/modules/apps.bicep`,
provision, and test again.

## 6. GitHub: sign-in without secrets

The pipeline signs in to Azure with OpenID Connect; no password or key is stored in GitHub.

1. Create an app registration (Entra ID), one per environment: `zyro-deploy-staging`,
   `zyro-deploy-prod`.
2. Add a **federated credential** to each: GitHub Actions, this repository, entity type
   **Environment**, name `staging` (or `production`).
3. Give each one **Contributor** on its own environment's resource group and **AcrPush** on its
   registry, and nothing at subscription level. The production one also needs **AcrPull** on the
   staging registry, because it copies the tested images from there.
4. In GitHub, Settings > Environments, create `staging` and `production`. On **production**, add
   **required reviewers** (the owners): this is the approval step before anything reaches paying
   merchants.
5. In each environment, add variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`,
   `AZURE_RESOURCE_GROUP`; in production also `STAGING_REGISTRY_ID` (the staging registry's resource
   id).
6. At repository level, set the variable `DEPLOY_ENABLED` to `true`. Until then the deploy workflow
   skips every job.

From then on: a green build of `main` goes to staging; production waits for a reviewer.

## 7. Custom domain

```sh
az containerapp hostname add -n <web app> -g <resource group> --hostname shop.example.com
az containerapp hostname bind -n <web app> -g <resource group> --hostname shop.example.com --environment <environment> --validation-method CNAME
```

Add the CNAME (and TXT for validation) records it asks for; the certificate is managed and renewed by
Azure, free. Then `azd env set ZYRO_CUSTOM_DOMAIN shop.example.com` and provision, so links and
emails use the domain.

## 8. Stripe webhooks

In the Stripe dashboard (test mode for staging, live for production), add an endpoint:
`https://<site>/api/v1/webhooks/stripe`, with the checkout and subscription events listed in
`documentation/Stripe_Setup_And_Verification.md`. Put its signing secret in
`ZYRO_STRIPE_WEBHOOK_SECRET` and provision. Pay once with a test card on staging and check the order
appears.

## 9. Before calling production live

- [ ] Quotas checked; plan section 6 complete.
- [ ] Staging: sign up, add a product with an image, buy it (card and cash on delivery), see it on
      the dashboard, refund it.
- [ ] Visitor address check (step 5) passed.
- [ ] A bank-transfer receipt opens for the merchant and **not** without the signed link.
- [ ] The deploy workflow has released to staging at least once, including one deliberate rollback
      (push a build that fails its health check and watch the previous revision keep serving).
- [ ] Alerts set up (Operations_Runbook.md).
- [ ] Terms of Service and Privacy Policy reviewed by someone qualified, and the operator's legal
      name and contact address filled in.
- [ ] The owners have decided what the site footer says about who runs ZYRO.

## Hardening after launch

These are the next steps up, deliberately not in the first release:

- **Private networking.** Put the Container Apps environment in a virtual network and reach
  PostgreSQL, Redis, Key Vault and Storage through private endpoints, with their public access off.
  Today PostgreSQL admits only Azure services, and everything else signs in with managed identities
  or secrets from Key Vault.
- **Azure Front Door with a web application firewall** in front of the site, for bot and attack
  filtering and a global edge cache for the built files.
- **Azure Verified Modules** in place of the hand-written resources, once their versions can be
  pinned and checked (see the plan, section 4).
- **PostgreSQL high availability** (zone-redundant) once the business can justify doubling its cost.
