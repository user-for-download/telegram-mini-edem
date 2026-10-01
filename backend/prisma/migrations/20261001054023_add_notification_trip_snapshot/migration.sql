-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "tripDepartureAt" TIMESTAMP(3),
ADD COLUMN     "tripFrom" TEXT,
ADD COLUMN     "tripPrice" INTEGER,
ADD COLUMN     "tripTo" TEXT;
