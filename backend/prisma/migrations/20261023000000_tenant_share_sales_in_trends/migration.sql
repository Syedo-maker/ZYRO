-- A shop's choice to keep its paid orders out of the platform's shared trends (Product Scout,
-- Trend Scout). Every existing shop keeps contributing, as before, until its owner switches it off.
-- Reversible: prisma/rollbacks/20261023000000_tenant_share_sales_in_trends.down.sql.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "shareSalesInTrends" BOOLEAN NOT NULL DEFAULT true;
