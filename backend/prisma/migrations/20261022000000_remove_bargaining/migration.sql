-- The supervisor's product-listing change removes haggling (Part G bargaining) entirely.
-- Deal codes it issued are ordinary single-use discount codes that expire within minutes; they stay.

-- DropForeignKey
ALTER TABLE "BargainSession" DROP CONSTRAINT "BargainSession_tenantId_fkey";

-- DropTable
DROP TABLE "BargainSession";
