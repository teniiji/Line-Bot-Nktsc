-- CreateTable
CREATE TABLE "CarriedDebtDismissal" (
    "id" TEXT NOT NULL,
    "debtId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarriedDebtDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CarriedDebtDismissal_debtId_sourceKey_key" ON "CarriedDebtDismissal"("debtId", "sourceKey");
