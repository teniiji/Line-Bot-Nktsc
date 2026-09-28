-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "asideFromLineId" TEXT;

-- CreateIndex
CREATE INDEX "Expense_asideFromLineId_idx" ON "Expense"("asideFromLineId");
