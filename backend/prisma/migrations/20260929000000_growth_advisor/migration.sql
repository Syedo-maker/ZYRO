-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "growthTipsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "GrowthTip" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "message" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrowthTip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GrowthTip_tenantId_createdAt_idx" ON "GrowthTip"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GrowthTip_tenantId_weekStart_key" ON "GrowthTip"("tenantId", "weekStart");

-- AddForeignKey
ALTER TABLE "GrowthTip" ADD CONSTRAINT "GrowthTip_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
