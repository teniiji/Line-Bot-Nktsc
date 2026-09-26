-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "splitFromLineId" TEXT;

-- CreateIndex
CREATE INDEX "Expense_splitFromLineId_idx" ON "Expense"("splitFromLineId");

-- CreateTable
CREATE TABLE "UnitPayer" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitPayer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnitPayer_key_key" ON "UnitPayer"("key");

-- CreateTable
CREATE TABLE "UnitPayerMember" (
    "id" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "memberNumber" TEXT NOT NULL,
    "lastAmount" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitPayerMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnitPayerMember_payerId_memberNumber_key" ON "UnitPayerMember"("payerId", "memberNumber");

-- CreateIndex
CREATE INDEX "UnitPayerMember_payerId_idx" ON "UnitPayerMember"("payerId");

-- CreateTable
CREATE TABLE "StatementLineSplit" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "memberNumber" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "payerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatementLineSplit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StatementLineSplit_lineId_idx" ON "StatementLineSplit"("lineId");
