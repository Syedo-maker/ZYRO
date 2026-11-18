-- Reverses migrations/20261112134521_store_themes, in one step:
--   npx prisma db execute --file prisma/rollbacks/20261112134521_store_themes.down.sql --schema prisma/schema.prisma
-- It drops both theme tables and removes the migration from Prisma's history, so `prisma migrate deploy`
-- can apply it again. Every store falls back to its default look. Remove the two models from
-- schema.prisma too if the rollback is meant to stay.
DROP TABLE IF EXISTS "StoreThemeVersion";
DROP TABLE IF EXISTS "StoreTheme";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261112134521_store_themes';
