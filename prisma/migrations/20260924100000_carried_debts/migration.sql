-- ชำระข้ามเดือน: a round can be closed at month end, and whatever members
-- still owe on it becomes a debt of its own, paid off separately from the
-- next month's round.

ALTER TABLE "StatementRound" ADD COLUMN "closedAt" TIMESTAMP(3);

CREATE TABLE "CarriedDebt" (
    "id" TEXT NOT NULL,
    "sourceRoundId" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "memberNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hCode" TEXT,
    "unitName" TEXT,
    "unitCode" TEXT,
    "accountNumber" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'unpaid',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarriedDebt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CarriedDebt_sourceRoundId_memberNumber_key" ON "CarriedDebt"("sourceRoundId", "memberNumber");
CREATE INDEX "CarriedDebt_memberNumber_idx" ON "CarriedDebt"("memberNumber");

CREATE TABLE "CarriedDebtPayment" (
    "id" TEXT NOT NULL,
    "debtId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL,
    "roundId" TEXT,
    "fingerprint" TEXT,
    "accountNumber" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarriedDebtPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CarriedDebtPayment_debtId_idx" ON "CarriedDebtPayment"("debtId");
CREATE INDEX "CarriedDebtPayment_roundId_fingerprint_idx" ON "CarriedDebtPayment"("roundId", "fingerprint");

-- How much of a transfer has been taken out of its round to pay a carried
-- debt instead.
ALTER TABLE "StatementTransfer" ADD COLUMN "carriedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
