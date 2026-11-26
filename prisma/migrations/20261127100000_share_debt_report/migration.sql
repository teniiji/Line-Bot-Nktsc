-- CreateTable
CREATE TABLE "ShareDebtReport" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "fileName" TEXT,
    "debtColumns" TEXT,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareDebtReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareDebtEntry" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "memberNumber" TEXT NOT NULL,
    "memberName" TEXT,
    "shares" DECIMAL(14,2),
    "debt" DECIMAL(14,2),
    "sharePeriods" INTEGER,

    CONSTRAINT "ShareDebtEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShareDebtReport_asOf_idx" ON "ShareDebtReport"("asOf");

-- CreateIndex
CREATE UNIQUE INDEX "ShareDebtEntry_reportId_memberNumber_key" ON "ShareDebtEntry"("reportId", "memberNumber");

-- AddForeignKey
ALTER TABLE "ShareDebtEntry" ADD CONSTRAINT "ShareDebtEntry_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ShareDebtReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
