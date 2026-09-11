-- Text messages kept under LINE's own message id, so that a later message
-- quoting one of them can be read back: LINE sends only the quoted message's
-- id, never its text. Both sides of the chat, truncated on write, pruned on a
-- fortnight's clock — see lib/quotedMessage.ts.
CREATE TABLE "QuotableMessage" (
    "id" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "fromBot" BOOLEAN NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotableMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuotableMessage_lineUserId_idx" ON "QuotableMessage"("lineUserId");

-- The prune reads this one.
CREATE INDEX "QuotableMessage_createdAt_idx" ON "QuotableMessage"("createdAt");
