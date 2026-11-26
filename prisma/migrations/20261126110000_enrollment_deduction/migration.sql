-- AlterTable
ALTER TABLE "CoverageEnrollment" ADD COLUMN     "deductionMarkedAt" TIMESTAMP(3),
ADD COLUMN     "deductionPeriod" TEXT,
ADD COLUMN     "premiumPaidAt" TIMESTAMP(3);
