-- Reverses migrations/20261114000000_store_policies, in one step:
--   npx prisma db execute --file prisma/rollbacks/20261114000000_store_policies.down.sql --schema prisma/schema.prisma
-- It drops the table and removes the migration from Prisma's history, so `prisma migrate deploy` can
-- apply it again. Every shop's written policies are lost: export them first. Remove the model from
-- schema.prisma too if the rollback is meant to stay.
DROP TABLE IF EXISTS "StorePolicy";
DROP TYPE IF EXISTS "StorePolicyKind";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261114000000_store_policies';
