-- One conversation, one webhook handler at a time.
--
-- LINE does not wait for a 200 before sending the next delivery, and each
-- delivery is its own serverless invocation, so a member who sends an image
-- and then types a line a second later could have two handlers running at
-- once. Both read the same PendingTransaction row, both decide, both write.
-- A member saw the result: two replies in the same minute, each quoting as
-- "the amount previously on record" the value the other had just written.
--
-- Ordering within a delivery cannot see across processes; the database can,
-- so the lock lives here. The primary key is what makes acquiring it atomic:
-- whoever manages to insert the row holds it.
CREATE TABLE "ConversationLock" (
    "key" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationLock_pkey" PRIMARY KEY ("key")
);

-- Stale locks are cleared by whoever next wants the key, so this only has to
-- serve that lookup.
CREATE INDEX "ConversationLock_expiresAt_idx" ON "ConversationLock"("expiresAt");
