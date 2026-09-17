-- A round can now start from the รายการหัก — the list payroll was asked to
-- deduct — instead of only from the results that come back weeks later. That
-- means a member row can exist before anybody knows whether the money was
-- collected, so the row has to say which it is.
--
-- expectedAmount is คอลัมน์ C ยอดแจ้งหัก, known from the moment the รายการหัก
-- goes in. deductionResult is awaiting / collected / uncollected.
--
-- Every row that already exists is uncollected, and the default says so: a
-- round used to be built from the หักไม่ได้ sheet, so being in one *meant*
-- payroll could not deduct. No backfill is needed and no existing round
-- changes meaning.

ALTER TABLE "StatementMember" ADD COLUMN "expectedAmount" DOUBLE PRECISION;
ALTER TABLE "StatementMember" ADD COLUMN "deductionResult" TEXT NOT NULL DEFAULT 'uncollected';

-- Reading a round by what its units have reported is the new common query.
CREATE INDEX "StatementMember_roundId_deductionResult_idx"
  ON "StatementMember" ("roundId", "deductionResult");
