-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "listedInDirectory" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "preferredExperience" TEXT;

-- CreateTable
CREATE TABLE "SearchTermDaily" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'all',
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchTermDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SearchTermDaily_category_day_idx" ON "SearchTermDaily"("category", "day");

-- CreateIndex
CREATE UNIQUE INDEX "SearchTermDaily_tenantId_term_category_day_key" ON "SearchTermDaily"("tenantId", "term", "category", "day");

-- AddForeignKey
ALTER TABLE "SearchTermDaily" ADD CONSTRAINT "SearchTermDaily_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

