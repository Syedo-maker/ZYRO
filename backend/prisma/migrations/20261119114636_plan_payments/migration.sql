-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "planProvisional" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "billingCurrency" TEXT,
ADD COLUMN     "billingCurrencyLockedAt" TIMESTAMP(3),
ADD COLUMN     "provisionalProUsedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PlanPaymentRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "plan" "PlanTier" NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_proof',
    "transactionId" TEXT,
    "proofKey" TEXT,
    "submittedAt" TIMESTAMP(3),
    "aiExtracted" JSONB,
    "aiStatus" TEXT,
    "findings" JSONB,
    "aiModel" TEXT,
    "provisionalUntil" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "receivedAmountMinor" INTEGER,
    "receivedCurrency" TEXT,
    "receivedPkrMinor" INTEGER,
    "periodEnd" TIMESTAMP(3),
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanPaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanReviewToken" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanReviewToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanAuditEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "requestId" TEXT,
    "actorUserId" TEXT,
    "actorKind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanPaymentRequest_referenceCode_key" ON "PlanPaymentRequest"("referenceCode");

-- CreateIndex
CREATE UNIQUE INDEX "PlanPaymentRequest_transactionId_key" ON "PlanPaymentRequest"("transactionId");

-- CreateIndex
CREATE INDEX "PlanPaymentRequest_status_submittedAt_idx" ON "PlanPaymentRequest"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "PlanPaymentRequest_tenantId_createdAt_idx" ON "PlanPaymentRequest"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanPaymentRequest_ownerId_idx" ON "PlanPaymentRequest"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanReviewToken_tokenHash_key" ON "PlanReviewToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PlanReviewToken_requestId_idx" ON "PlanReviewToken"("requestId");

-- CreateIndex
CREATE INDEX "PlanAuditEvent_tenantId_createdAt_idx" ON "PlanAuditEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanAuditEvent_requestId_idx" ON "PlanAuditEvent"("requestId");

-- AddForeignKey
ALTER TABLE "PlanPaymentRequest" ADD CONSTRAINT "PlanPaymentRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanPaymentRequest" ADD CONSTRAINT "PlanPaymentRequest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanReviewToken" ADD CONSTRAINT "PlanReviewToken_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PlanPaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
