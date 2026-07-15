-- DropIndex
DROP INDEX "Expense_lineUserId_idx";

-- CreateIndex
CREATE INDEX "Expense_lineUserId_date_idx" ON "Expense"("lineUserId", "date");

