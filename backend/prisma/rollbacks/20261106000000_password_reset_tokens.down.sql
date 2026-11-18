-- Reverses migrations/20261106000000_password_reset_tokens, in one step:
--   npx prisma db execute --file prisma/rollbacks/20261106000000_password_reset_tokens.down.sql --schema prisma/schema.prisma
-- It drops the table and removes the migration from Prisma's history, so `prisma migrate deploy` can
-- apply it again. Reset links already sent stop working. Remove the model from schema.prisma too if the
-- rollback is meant to stay.
DROP TABLE IF EXISTS "PasswordResetToken";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261106000000_password_reset_tokens';
