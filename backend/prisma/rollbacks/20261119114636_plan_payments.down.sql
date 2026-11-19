-- Reverses migrations/20261119114636_plan_payments, in one step:
--   npx prisma db execute --file prisma/rollbacks/20261119114636_plan_payments.down.sql --schema prisma/schema.prisma
-- It drops the plan payment tables and columns and removes the migration from Prisma's history, so
-- `prisma migrate deploy` can apply it again. Every upgrade request, review link and plan audit entry is
-- lost, and provisional plans are no longer marked as provisional: export the audit log first. Remove
-- the models from schema.prisma too if the rollback is meant to stay.
DROP TABLE IF EXISTS "PlanReviewToken";
DROP TABLE IF EXISTS "PlanPaymentRequest";
DROP TABLE IF EXISTS "PlanAuditEvent";
ALTER TABLE "Tenant" DROP COLUMN IF EXISTS "planProvisional";
ALTER TABLE "User" DROP COLUMN IF EXISTS "billingCurrency";
ALTER TABLE "User" DROP COLUMN IF EXISTS "billingCurrencyLockedAt";
ALTER TABLE "User" DROP COLUMN IF EXISTS "provisionalProUsedAt";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261119114636_plan_payments';
