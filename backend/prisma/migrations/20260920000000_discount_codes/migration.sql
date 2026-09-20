-- AlterTable
ALTER TABLE "CheckoutSession" ADD COLUMN     "discountCodeId" TEXT;

-- AlterTable
ALTER TABLE "DiscountCode" ADD COLUMN     "minSubtotal" DECIMAL(10,2);

-- CreateIndex
CREATE INDEX "CheckoutSession_discountCodeId_status_expiresAt_idx" ON "CheckoutSession"("discountCodeId", "status", "expiresAt");

-- AddForeignKey
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "DiscountCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Codes are stored upper-case and looked up case-insensitively by upper-casing the input.
ALTER TABLE "DiscountCode" ADD CONSTRAINT "DiscountCode_code_upper" CHECK ("code" = upper("code") AND "code" ~ '^[A-Z0-9_-]{3,30}$');
-- Last line of defence for the discount rules (the API validates first).
ALTER TABLE "DiscountCode" ADD CONSTRAINT "DiscountCode_value_positive" CHECK ("value" > 0);
ALTER TABLE "DiscountCode" ADD CONSTRAINT "DiscountCode_percentage_max" CHECK ("type" <> 'PERCENTAGE' OR "value" <= 100);
ALTER TABLE "DiscountCode" ADD CONSTRAINT "DiscountCode_usage_valid" CHECK ("usageCount" >= 0 AND ("usageLimit" IS NULL OR "usageLimit" >= 1));
ALTER TABLE "DiscountCode" ADD CONSTRAINT "DiscountCode_minSubtotal_nonneg" CHECK ("minSubtotal" IS NULL OR "minSubtotal" >= 0);