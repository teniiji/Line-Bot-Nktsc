-- Several units may share one statement wording (the bank cuts it short).
DROP INDEX "UnitPayer_key_key";
CREATE INDEX "UnitPayer_key_idx" ON "UnitPayer"("key");

-- Which unit a line is from, as staff chose it.
CREATE TABLE "StatementLinePayer" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatementLinePayer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StatementLinePayer_lineId_key" ON "StatementLinePayer"("lineId");
CREATE INDEX "StatementLinePayer_payerId_idx" ON "StatementLinePayer"("payerId");
