-- Lets a member ask the bot for their own เลขสมาชิก after verifying their
-- identity against the imported roster (name + national ID + phone).
ALTER TABLE "MemberRoster" ADD COLUMN "nationalId" TEXT;
ALTER TABLE "MemberRoster" ADD COLUMN "phone" TEXT;
CREATE INDEX "MemberRoster_nationalId_idx" ON "MemberRoster"("nationalId");

CREATE TABLE "PendingMemberLookup" (
    "id" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "fullName" TEXT,
    "nationalId" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingMemberLookup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PendingMemberLookup_lineUserId_key" ON "PendingMemberLookup"("lineUserId");
