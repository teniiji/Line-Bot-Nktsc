-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "loanType" TEXT,
ADD COLUMN     "memberFullName" TEXT,
ADD COLUMN     "memberNumber" TEXT;

-- AlterTable
ALTER TABLE "LineUser" ADD COLUMN     "fullName" TEXT,
ADD COLUMN     "memberNumber" TEXT;

-- AlterTable
ALTER TABLE "PendingTransaction" ADD COLUMN     "category" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "loanType" TEXT,
ALTER COLUMN "amount" DROP NOT NULL,
ALTER COLUMN "date" DROP NOT NULL;
