-- AlterTable
ALTER TABLE "AiUsageQuota" ADD COLUMN     "cachedAnswers" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "inputTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "outputTokens" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TenantMonthlyUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "onlineOrders" INTEGER NOT NULL DEFAULT 0,
    "posOrders" INTEGER NOT NULL DEFAULT 0,
    "grossSales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refundCount" INTEGER NOT NULL DEFAULT 0,
    "refundTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantMonthlyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantMonthlyUsage_month_idx" ON "TenantMonthlyUsage"("month");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMonthlyUsage_tenantId_month_key" ON "TenantMonthlyUsage"("tenantId", "month");

-- AddForeignKey
ALTER TABLE "TenantMonthlyUsage" ADD CONSTRAINT "TenantMonthlyUsage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill (Part B): the counters start from the orders, refunds and returns already recorded, with
-- the same definitions the running code uses (see src/modules/usage/usage.service.ts). An order counts
-- once, at its total, in the UTC month it was created, if a payment was taken; refunds and returns
-- count in the UTC month they were paid back.
INSERT INTO "TenantMonthlyUsage" ("id", "tenantId", "month", "onlineOrders", "posOrders", "grossSales", "refundCount", "refundTotal", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || x."tenantId" || x."month"), x."tenantId", x."month",
       sum(x."online")::int, sum(x."pos")::int, sum(x."gross"), sum(x."refunds")::int, sum(x."refunded"), CURRENT_TIMESTAMP
FROM (
  SELECT o."tenantId", to_char(o."createdAt", 'YYYY-MM') AS "month",
         CASE WHEN o."channel" = 'ONLINE' THEN 1 ELSE 0 END AS "online",
         CASE WHEN o."channel" = 'POS' THEN 1 ELSE 0 END AS "pos",
         o."total" AS "gross", 0 AS "refunds", 0::numeric AS "refunded"
  FROM "Order" o
  WHERE EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o."id" AND p."status" IN ('SUCCEEDED', 'REFUNDED'))
  UNION ALL
  SELECT r."tenantId", to_char(r."createdAt", 'YYYY-MM'), 0, 0, 0, 1, r."amount" FROM "Refund" r
  UNION ALL
  SELECT rt."tenantId", to_char(rt."createdAt", 'YYYY-MM'), 0, 0, 0, 1, rt."amount" FROM "OrderReturn" rt
) x
GROUP BY x."tenantId", x."month";
