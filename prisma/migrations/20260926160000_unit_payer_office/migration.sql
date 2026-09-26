-- AlterTable
ALTER TABLE "UnitPayerMember" ADD COLUMN "viaOffice" TEXT;

-- CreateTable
CREATE TABLE "UnitPayerOffice" (
    "id" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "deductingUnit" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnitPayerOffice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnitPayerOffice_deductingUnit_key" ON "UnitPayerOffice"("deductingUnit");

-- CreateIndex
CREATE INDEX "UnitPayerOffice_payerId_idx" ON "UnitPayerOffice"("payerId");
