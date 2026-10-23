-- Each order line keeps the product's actual price (MRP) and the discount per unit at the time of
-- sale, beside the price paid, so receipts and invoices can say "you saved Rs 200". Order prices never
-- change after the sale: these columns are written once, when the order is created.
-- Older lines are backfilled as MRP = the price paid and no discount, so old receipts read as before.
-- Reversible: prisma/rollbacks/20261023100000_order_item_price_snapshot.down.sql.

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "unitMrpSnapshot" DECIMAL(10,2);
ALTER TABLE "OrderItem" ADD COLUMN "unitDiscountSnapshot" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Backfill, then require the MRP on every line.
UPDATE "OrderItem" SET "unitMrpSnapshot" = "unitPrice" WHERE "unitMrpSnapshot" IS NULL;
ALTER TABLE "OrderItem" ALTER COLUMN "unitMrpSnapshot" SET NOT NULL;

-- The three always add up: MRP minus the discount is what was paid, and the discount is never negative.
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_price_snapshot_adds_up"
  CHECK ("unitDiscountSnapshot" >= 0 AND "unitMrpSnapshot" - "unitDiscountSnapshot" = "unitPrice");
