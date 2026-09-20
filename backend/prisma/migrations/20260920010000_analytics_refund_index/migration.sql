-- DropIndex
DROP INDEX "Refund_tenantId_idx";

-- CreateIndex
CREATE INDEX "Refund_tenantId_createdAt_idx" ON "Refund"("tenantId", "createdAt");
