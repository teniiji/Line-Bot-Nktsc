-- CreateTable
CREATE TABLE "DeductionRound" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeductionRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeductionUnitFile" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "unitName" TEXT NOT NULL,
    "fileName" TEXT,
    "filePath" TEXT,
    "amount" DOUBLE PRECISION,
    "memberCount" INTEGER,
    "sendStatus" TEXT NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMP(3),
    "sentVia" TEXT,
    "sendError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeductionUnitFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeductionRound_period_key" ON "DeductionRound"("period");

-- CreateIndex
CREATE INDEX "DeductionUnitFile_roundId_idx" ON "DeductionUnitFile"("roundId");

-- CreateIndex
CREATE UNIQUE INDEX "DeductionUnitFile_roundId_unitName_key" ON "DeductionUnitFile"("roundId", "unitName");

-- RenameIndex
-- Not part of this feature: leftover drift from 20260716070000, which renamed
-- LoanDistrictContact.district to unitName. Postgres keeps an index's name
-- when its column is renamed, so the index has been called
-- LoanDistrictContact_district_key ever since while the schema expected
-- _unitName_key. Prisma folds the correction into whichever migration comes
-- next; keeping it here (a name change, nothing else) rather than deferring it
-- to land unexplained in someone else's.
ALTER INDEX "LoanDistrictContact_district_key" RENAME TO "LoanDistrictContact_unitName_key";
