-- A member may have more than one slip waiting at once.
--
-- PendingTransaction.lineUserId was unique, so the row was the member rather
-- than the payment: a second slip sent before the first was identified
-- overwrote it, and that payment was lost with no trace anywhere but the LINE
-- chat. Members do send two in a row — one to the cooperative, one to
-- ฌาปนกิจสงเคราะห์ — so the rows now queue and are answered oldest first.
--
-- Dropping a unique constraint never fails on existing data: every row that
-- satisfied it still satisfies the weaker index. Nothing is deleted, and rows
-- already pending keep working exactly as they did.
DROP INDEX "PendingTransaction_lineUserId_key";

CREATE INDEX "PendingTransaction_lineUserId_createdAt_idx" ON "PendingTransaction"("lineUserId", "createdAt");

-- Splitting "created" from "last touched".
--
-- They were the same field, and every update rewrote it. That was harmless
-- while a member could have only one pending row. It is not harmless now:
-- createdAt is the queue order, so answering a question about the older
-- payment would have sent it to the back of its own queue and the bot would
-- have switched to asking about the newer one mid-conversation.
--
-- Existing rows carry their createdAt across, so nothing already pending
-- expires early or late because of this.
ALTER TABLE "PendingTransaction" ADD COLUMN "lastActivityAt" TIMESTAMP(3);
UPDATE "PendingTransaction" SET "lastActivityAt" = "createdAt" WHERE "lastActivityAt" IS NULL;
ALTER TABLE "PendingTransaction" ALTER COLUMN "lastActivityAt" SET NOT NULL;
ALTER TABLE "PendingTransaction" ALTER COLUMN "lastActivityAt" SET DEFAULT CURRENT_TIMESTAMP;
