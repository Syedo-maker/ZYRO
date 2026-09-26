-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('FREE', 'PRO', 'BUSINESS');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "aiTopUpChatMessages" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "aiTopUpGenerations" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "customDomain" TEXT,
ADD COLUMN     "plan" "PlanTier" NOT NULL DEFAULT 'FREE',
ADD COLUMN     "planExpiresAt" TIMESTAMP(3),
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT;

-- CreateTable
CREATE TABLE "AiTopUpPurchase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "generations" INTEGER NOT NULL,
    "chatMessages" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "stripeSessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiTopUpPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiTopUpPurchase_stripeSessionId_key" ON "AiTopUpPurchase"("stripeSessionId");

-- CreateIndex
CREATE INDEX "AiTopUpPurchase_tenantId_idx" ON "AiTopUpPurchase"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_stripeCustomerId_key" ON "Tenant"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_stripeSubscriptionId_key" ON "Tenant"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_customDomain_key" ON "Tenant"("customDomain");

-- AddForeignKey
ALTER TABLE "AiTopUpPurchase" ADD CONSTRAINT "AiTopUpPurchase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
