-- Reverses migrations/20261023100000_order_item_price_snapshot, in one step:
--   npx prisma db execute --file prisma/rollbacks/20261023100000_order_item_price_snapshot.down.sql --schema prisma/schema.prisma
-- It drops the constraint and the two columns and removes the migration from Prisma's history, so
-- `prisma migrate deploy` can apply it again. The price paid (unitPrice) is untouched; only each
-- line's MRP and discount at the time of sale are lost, so receipts can no longer show what was
-- saved. Remove the fields from schema.prisma too if the rollback is meant to stay.
ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_price_snapshot_adds_up";
ALTER TABLE "OrderItem" DROP COLUMN IF EXISTS "unitDiscountSnapshot";
ALTER TABLE "OrderItem" DROP COLUMN IF EXISTS "unitMrpSnapshot";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261023100000_order_item_price_snapshot';
