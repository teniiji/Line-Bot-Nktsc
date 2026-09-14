-- LINE group chats the bot has been added to, so a notification can go to a
-- group instead of one person. Rows are created from webhook events only —
-- a group id cannot be typed in, and being listed here grants nothing until
-- staff pick the group as a target.
CREATE TABLE "LineGroup" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "note" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LineGroup_groupId_key" ON "LineGroup"("groupId");

-- The panel lists the chats the bot is still in first.
CREATE INDEX "LineGroup_leftAt_idx" ON "LineGroup"("leftAt");
