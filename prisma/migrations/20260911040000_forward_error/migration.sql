-- Why a forward to staff failed, kept on the row staff read rather than only
-- in a server log. Nullable: every row already written has no reason, and
-- most forwards never fail.
ALTER TABLE "Expense" ADD COLUMN "forwardError" TEXT;
ALTER TABLE "ServiceRequestLog" ADD COLUMN "forwardError" TEXT;
