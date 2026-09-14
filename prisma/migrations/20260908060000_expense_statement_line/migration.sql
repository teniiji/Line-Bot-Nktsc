-- Lets staff record a payment straight from a bank line in the daily view,
-- and remembers which line it was recorded from.
--
-- Additive and nullable: every existing transaction came from a slip a member
-- sent and has no statement line behind it, which stays true.
--
-- The unique index is the duplicate guard. Postgres treats NULLs as distinct,
-- so the millions of slip-sourced rows are unaffected; it only refuses a
-- second transaction claiming the same bank line.
ALTER TABLE "Expense" ADD COLUMN "statementLineId" TEXT;

CREATE UNIQUE INDEX "Expense_statementLineId_key" ON "Expense"("statementLineId");
