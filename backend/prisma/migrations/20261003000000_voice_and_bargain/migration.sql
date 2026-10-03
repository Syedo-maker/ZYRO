-- CreateTable
CREATE TABLE "VoiceNote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "audioUrl" TEXT NOT NULL,
    "transcript" TEXT NOT NULL,
    "language" TEXT,
    "draft" JSONB,
    "problem" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "appliedAt" TIMESTAMP(3),
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BargainSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT,
    "guestSessionId" TEXT,
    "listPrice" DECIMAL(10,2) NOT NULL,
    "floorPrice" DECIMAL(10,2) NOT NULL,
    "currentOffer" DECIMAL(10,2) NOT NULL,
    "shopperOffer" DECIMAL(10,2),
    "rounds" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "discountCodeId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BargainSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoiceNote_tenantId_status_idx" ON "VoiceNote"("tenantId", "status");

-- CreateIndex
CREATE INDEX "BargainSession_tenantId_status_idx" ON "BargainSession"("tenantId", "status");

-- CreateIndex
CREATE INDEX "BargainSession_tenantId_productId_idx" ON "BargainSession"("tenantId", "productId");

-- AddForeignKey
ALTER TABLE "VoiceNote" ADD CONSTRAINT "VoiceNote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BargainSession" ADD CONSTRAINT "BargainSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

