-- Records how much of the uploaded หักไม่ได้ sheet had no deduction result
-- yet, so a round does not look complete when a batch of units has simply
-- not reported back. Those rows are not imported (nobody knows whether those
-- members paid), and they are not kept anywhere else, so the counts are
-- stored on the round itself.

ALTER TABLE "StatementRound" ADD COLUMN "awaitingUnits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StatementRound" ADD COLUMN "awaitingMembers" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StatementRound" ADD COLUMN "awaitingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
