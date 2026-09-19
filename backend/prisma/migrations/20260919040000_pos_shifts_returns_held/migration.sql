-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "clientRequestId" TEXT,
ADD COLUMN     "discountReason" TEXT,
ADD COLUMN     "shiftId" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "returnedQuantity" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "tenderedAmount" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "shiftId" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "posMaxDiscountPercent" DECIMAL(5,2) NOT NULL DEFAULT 20;

-- CreateTable
CREATE TABLE "PosShift" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openedByUserId" TEXT NOT NULL,
    "closedByUserId" TEXT,
    "openingFloat" DECIMAL(10,2) NOT NULL,
    "expectedCash" DECIMAL(10,2),
    "countedCash" DECIMAL(10,2),
    "variance" DECIMAL(10,2),
    "note" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "PosShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderReturn" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shiftId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reason" TEXT,
    "restocked" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderReturnItem" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitleSnapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "OrderReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeldSale" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cashierUserId" TEXT NOT NULL,
    "label" TEXT,
    "customerId" TEXT,
    "items" JSONB NOT NULL,
    "discount" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeldSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosShift_tenantId_status_idx" ON "PosShift"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PosShift_tenantId_openedAt_idx" ON "PosShift"("tenantId", "openedAt");

-- CreateIndex
CREATE INDEX "OrderReturn_tenantId_createdAt_idx" ON "OrderReturn"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderReturn_orderId_idx" ON "OrderReturn"("orderId");

-- CreateIndex
CREATE INDEX "OrderReturn_shiftId_idx" ON "OrderReturn"("shiftId");

-- CreateIndex
CREATE INDEX "OrderReturnItem_returnId_idx" ON "OrderReturnItem"("returnId");

-- CreateIndex
CREATE INDEX "HeldSale_tenantId_createdAt_idx" ON "HeldSale"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_tenantId_clientRequestId_key" ON "Order"("tenantId", "clientRequestId");

-- CreateIndex
CREATE INDEX "Refund_shiftId_idx" ON "Refund"("shiftId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "PosShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderReturn" ADD CONSTRAINT "OrderReturn_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderReturn" ADD CONSTRAINT "OrderReturn_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderReturnItem" ADD CONSTRAINT "OrderReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "OrderReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderReturnItem" ADD CONSTRAINT "OrderReturnItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeldSale" ADD CONSTRAINT "HeldSale_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A location can have only one open shift (one register per store). Prisma cannot express
-- a partial unique index, so it lives here; it makes "open a shift" safe under concurrency.
CREATE UNIQUE INDEX "PosShift_one_open_per_location" ON "PosShift"("tenantId", "locationId") WHERE "status" = 'OPEN';

-- Last line of defence for money and quantities, the same idea as the InventoryLevel check.
ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_openingFloat_nonneg" CHECK ("openingFloat" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_returnedQuantity_range" CHECK ("returnedQuantity" >= 0 AND "returnedQuantity" <= "quantity");
ALTER TABLE "OrderReturn" ADD CONSTRAINT "OrderReturn_amount_nonneg" CHECK ("amount" >= 0);
ALTER TABLE "OrderReturnItem" ADD CONSTRAINT "OrderReturnItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_posMaxDiscountPercent_range" CHECK ("posMaxDiscountPercent" >= 0 AND "posMaxDiscountPercent" <= 100);