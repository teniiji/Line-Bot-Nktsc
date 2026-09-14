-- Directory of the bank accounts members transfer from, so an account number
-- that the หักไม่ได้ sheet gets wrong or leaves blank can be bound to its owner
-- once instead of being re-fixed in the spreadsheet every round.

CREATE TABLE "MemberBankAccount" (
    "id" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "memberNumber" TEXT NOT NULL,
    "memberName" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberBankAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MemberBankAccount_accountNumber_key" ON "MemberBankAccount"("accountNumber");
CREATE INDEX "MemberBankAccount_memberNumber_idx" ON "MemberBankAccount"("memberNumber");

-- Records where a member's account number came from, so a binding that is
-- later corrected or deleted can take back the value it supplied. Existing
-- rows all came from an uploaded sheet.
ALTER TABLE "StatementMember" ADD COLUMN "accountSource" TEXT;
