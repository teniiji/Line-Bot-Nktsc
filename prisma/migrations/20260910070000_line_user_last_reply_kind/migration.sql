-- Why the last reply was sent, so a reply that would repeat it can be
-- withheld instead of reworded. Nullable: every reply already sent has no
-- kind, and most replies never will.
ALTER TABLE "LineUser" ADD COLUMN "lastReplyKind" TEXT;
