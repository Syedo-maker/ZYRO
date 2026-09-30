-- CreateTable
CREATE TABLE "TrendReport" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "storeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendSignalImport" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "geo" TEXT NOT NULL,
    "series" JSONB NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "fileName" TEXT,
    "importedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendSignalImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrendReport_market_weekStart_idx" ON "TrendReport"("market", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "TrendReport_market_category_weekStart_key" ON "TrendReport"("market", "category", "weekStart");

-- CreateIndex
CREATE INDEX "TrendSignalImport_market_category_createdAt_idx" ON "TrendSignalImport"("market", "category", "createdAt");

