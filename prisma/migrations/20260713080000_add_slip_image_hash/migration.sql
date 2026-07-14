-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "slipImageHash" TEXT;

-- AlterTable
ALTER TABLE "PendingTransaction" ADD COLUMN     "slipImageHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Expense_slipImageHash_key" ON "Expense"("slipImageHash");
