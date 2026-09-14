-- CreateTable
CREATE TABLE "StatementRound" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatementRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatementMember" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "memberNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitName" TEXT,
    "hCode" TEXT,
    "note" TEXT,
    "accountNumber" TEXT,
    "amountDue" DOUBLE PRECISION NOT NULL,
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "paidBranch" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unpaid',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatementMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatementTransfer" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "memberNumber" TEXT,
    "accountNumber" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "transferredAt" TIMESTAMP(3),
    "account" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatementTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StatementRound_period_key" ON "StatementRound"("period");

-- CreateIndex
CREATE INDEX "StatementMember_roundId_idx" ON "StatementMember"("roundId");

-- CreateIndex
CREATE UNIQUE INDEX "StatementMember_roundId_memberNumber_key" ON "StatementMember"("roundId", "memberNumber");

-- CreateIndex
CREATE INDEX "StatementTransfer_roundId_idx" ON "StatementTransfer"("roundId");

-- CreateIndex
CREATE INDEX "StatementTransfer_roundId_account_idx" ON "StatementTransfer"("roundId", "account");

