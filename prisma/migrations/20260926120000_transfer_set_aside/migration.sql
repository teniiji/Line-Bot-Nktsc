-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "setAsideFromId" TEXT;

-- CreateIndex
CREATE INDEX "Expense_setAsideFromId_idx" ON "Expense"("setAsideFromId");
