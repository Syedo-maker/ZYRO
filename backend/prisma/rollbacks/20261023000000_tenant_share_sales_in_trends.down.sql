-- Reverses migrations/20261023000000_tenant_share_sales_in_trends, in one step:
--   npx prisma db execute --file prisma/rollbacks/20261023000000_tenant_share_sales_in_trends.down.sql --schema prisma/schema.prisma
-- It drops the column and removes the migration from Prisma's history, so `prisma migrate deploy` can
-- apply it again. Every shop's choice to opt out is lost: after a rollback all shops contribute again,
-- so do not roll back without telling the owners who opted out. Remove the field from schema.prisma
-- too if the rollback is meant to stay.
ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "shareSalesInTrends";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261023000000_tenant_share_sales_in_trends';
