-- Reverses migrations/20261022100000_product_scout_snapshot, in one step:
--   npx prisma db execute --file prisma/rollbacks/20261022100000_product_scout_snapshot.down.sql --schema prisma/schema.prisma
-- It drops the table and removes the migration from Prisma's history, so `prisma migrate deploy`
-- can apply it again later. (`prisma migrate resolve --rolled-back` only works for a failed
-- migration, not an applied one.) Only the cached trends are lost: the next daily run recomputes
-- them from orders. Remove the model from schema.prisma too if the rollback is meant to stay.
DROP TABLE IF EXISTS "ProductScoutSnapshot";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261022100000_product_scout_snapshot';
