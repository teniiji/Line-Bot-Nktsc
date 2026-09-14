-- The transfer time and the paying account, read off the slip.
--
-- Both are nullable and stay null on every existing row: nothing re-reads
-- slips already logged, so old transactions simply carry no time and no
-- account, and the daily reconciliation falls back to matching on the amount
-- exactly as it does today.
--
-- The time is text, not a timestamp: a slip prints a wall-clock time and says
-- nothing about which zone it is in, so storing it as "HH:MM" keeps the fact
-- as it was printed instead of a timestamp that quietly shifts. The account
-- is kept exactly as printed, mask characters included ("xxx-x-x7288-5"), so
-- a later change to how much of it can be matched needs no slips re-read.
ALTER TABLE "Expense" ADD COLUMN "slipTransferTime" TEXT;
ALTER TABLE "Expense" ADD COLUMN "slipSenderAccount" TEXT;

ALTER TABLE "PendingTransaction" ADD COLUMN "slipTransferTime" TEXT;
ALTER TABLE "PendingTransaction" ADD COLUMN "slipSenderAccount" TEXT;
