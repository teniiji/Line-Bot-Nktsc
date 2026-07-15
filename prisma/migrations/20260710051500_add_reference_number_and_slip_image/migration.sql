-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "referenceNumber" TEXT,
ADD COLUMN     "slipImageUrl" TEXT;

-- AlterTable
ALTER TABLE "PendingTransaction" ADD COLUMN     "slipImageUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Expense_referenceNumber_key" ON "Expense"("referenceNumber");

