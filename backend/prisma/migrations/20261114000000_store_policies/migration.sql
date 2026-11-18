-- CreateEnum
CREATE TYPE "StorePolicyKind" AS ENUM ('REFUND', 'SHIPPING', 'PRIVACY', 'TERMS');

-- CreateTable
CREATE TABLE "StorePolicy" (
    "tenantId" TEXT NOT NULL,
    "kind" "StorePolicyKind" NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorePolicy_pkey" PRIMARY KEY ("tenantId","kind")
);

-- AddForeignKey
ALTER TABLE "StorePolicy" ADD CONSTRAINT "StorePolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

