-- Reverses migrations/20261114010000_email_opt_out, in one step:
--   npx prisma db execute --file prisma/rollbacks/20261114010000_email_opt_out.down.sql --schema prisma/schema.prisma
-- It drops the table and removes the migration from Prisma's history, so `prisma migrate deploy` can
-- apply it again. CAUTION: shoppers who unsubscribed would get cart reminders again; keep cart
-- recovery switched off until the table is back. Remove the model from schema.prisma too if the
-- rollback is meant to stay.
DROP TABLE IF EXISTS "EmailOptOut";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261114010000_email_opt_out';
