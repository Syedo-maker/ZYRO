-- CreateTable
CREATE TABLE "EmailOptOut" (
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailOptOut_pkey" PRIMARY KEY ("tenantId","userId")
);

-- CreateIndex
CREATE INDEX "EmailOptOut_userId_idx" ON "EmailOptOut"("userId");

-- AddForeignKey
ALTER TABLE "EmailOptOut" ADD CONSTRAINT "EmailOptOut_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailOptOut" ADD CONSTRAINT "EmailOptOut_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

