-- Every line of every uploaded bank statement, kept as the bank wrote it.
-- Separate from "StatementTransfer", which stays limited to member transfers
-- inside a round because the round's payment arithmetic reads it.
CREATE TABLE "StatementLine" (
    "id" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),
    "txnCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "balance" DOUBLE PRECISION,
    "senderAccount" TEXT,
    "channel" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "sourceFile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatementLine_pkey" PRIMARY KEY ("id")
);

-- Overlapping date ranges mean the same line arrives more than once; scoped to
-- the account so two rounds loading overlapping files cannot store it twice.
CREATE UNIQUE INDEX "StatementLine_account_fingerprint_key" ON "StatementLine"("account", "fingerprint");

CREATE INDEX "StatementLine_postedAt_idx" ON "StatementLine"("postedAt");

-- The daily reconciliation asks for one day's member deposits.
CREATE INDEX "StatementLine_channel_postedAt_idx" ON "StatementLine"("channel", "postedAt");
