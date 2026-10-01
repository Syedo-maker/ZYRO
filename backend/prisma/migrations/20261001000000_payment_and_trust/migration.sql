-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentMethod" ADD VALUE 'COD';
ALTER TYPE "PaymentMethod" ADD VALUE 'BANK_TRANSFER';
ALTER TYPE "PaymentMethod" ADD VALUE 'GATEWAY';

-- CreateTable
CREATE TABLE "PaymentSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "codEnabled" BOOLEAN NOT NULL DEFAULT false,
    "codMinAmount" DECIMAL(10,2),
    "codMaxAmount" DECIMAL(10,2),
    "codBlockBand" TEXT NOT NULL DEFAULT 'high',
    "codAdvancePercent" INTEGER NOT NULL DEFAULT 0,
    "bankTransferEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bankAccountName" TEXT,
    "bankAccountNumber" TEXT,
    "bankName" TEXT,
    "bankInstructions" TEXT,
    "gatewayProvider" TEXT,
    "gatewayEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodAssessment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT,
    "score" INTEGER NOT NULL,
    "band" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "inputs" JSONB NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodPhoneSignal" (
    "id" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "delivered" INTEGER NOT NULL DEFAULT 0,
    "refused" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodPhoneSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentProof" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "declaredAmount" DECIMAL(10,2) NOT NULL,
    "declaredReference" TEXT,
    "extracted" JSONB,
    "findings" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodRemittanceRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courier" TEXT NOT NULL,
    "fileName" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "problemCount" INTEGER NOT NULL DEFAULT 0,
    "fileTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "matchedTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "importedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodRemittanceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodRemittanceItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "orderId" TEXT,
    "status" TEXT NOT NULL,
    "detail" TEXT,

    CONSTRAINT "CodRemittanceItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSettings_tenantId_key" ON "PaymentSettings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CodAssessment_orderId_key" ON "CodAssessment"("orderId");

-- CreateIndex
CREATE INDEX "CodAssessment_tenantId_createdAt_idx" ON "CodAssessment"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CodPhoneSignal_phoneHash_key" ON "CodPhoneSignal"("phoneHash");

-- CreateIndex
CREATE INDEX "PaymentProof_tenantId_status_idx" ON "PaymentProof"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PaymentProof_orderId_idx" ON "PaymentProof"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProof_tenantId_declaredReference_key" ON "PaymentProof"("tenantId", "declaredReference");

-- CreateIndex
CREATE INDEX "CodRemittanceRun_tenantId_createdAt_idx" ON "CodRemittanceRun"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "CodRemittanceItem_runId_idx" ON "CodRemittanceItem"("runId");

-- CreateIndex
CREATE INDEX "CodRemittanceItem_tenantId_status_idx" ON "CodRemittanceItem"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "PaymentSettings" ADD CONSTRAINT "PaymentSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodAssessment" ADD CONSTRAINT "CodAssessment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodAssessment" ADD CONSTRAINT "CodAssessment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProof" ADD CONSTRAINT "PaymentProof_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProof" ADD CONSTRAINT "PaymentProof_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodRemittanceRun" ADD CONSTRAINT "CodRemittanceRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodRemittanceItem" ADD CONSTRAINT "CodRemittanceItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CodRemittanceRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodRemittanceItem" ADD CONSTRAINT "CodRemittanceItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodRemittanceItem" ADD CONSTRAINT "CodRemittanceItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

