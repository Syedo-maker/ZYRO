-- Product Scout: the platform's anonymised product trends, one row per scope, market and period.
-- Reversible: prisma/rollbacks/20261022100000_product_scout_snapshot.down.sql drops it again.

-- CreateTable
CREATE TABLE "ProductScoutSnapshot" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "periodDays" INTEGER NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductScoutSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductScoutSnapshot_scope_market_periodDays_key" ON "ProductScoutSnapshot"("scope", "market", "periodDays");
