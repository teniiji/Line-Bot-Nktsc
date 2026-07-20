-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "slipSenderName" TEXT;
ALTER TABLE "Expense" ADD COLUMN "senderNameMismatch" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PendingTransaction" ADD COLUMN "slipSenderName" TEXT;
ALTER TABLE "PendingTransaction" ADD COLUMN "senderNameConfirmed" BOOLEAN NOT NULL DEFAULT false;
