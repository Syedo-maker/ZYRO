-- DropForeignKey
ALTER TABLE "PosShift" DROP CONSTRAINT "PosShift_locationId_fkey";

-- AddForeignKey
ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
