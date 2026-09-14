-- One turn of memory for the bot: the last thing it said to this member, and
-- when. Read back by lib/recentReply.ts so two messages sent a second apart
-- do not get two answers that say the same thing.
--
-- Both nullable and both additive: every existing row reads as "nothing said
-- recently", which is exactly the behaviour before this migration, and code
-- that does not know about these columns is unaffected.
ALTER TABLE "LineUser" ADD COLUMN "lastReplyText" TEXT;
ALTER TABLE "LineUser" ADD COLUMN "lastReplyAt" TIMESTAMP(3);
