-- Rate-limit submit_lookup_info (lib/agent/identityHandlers.ts).
--
-- Identity verification there (matchesIdentity in lib/memberLookup.ts)
-- requires name + national ID + phone to all match a roster row at once,
-- so a blind guess is already unlikely to succeed. But nothing previously
-- stopped unlimited retries through chat, so someone who already knows a
-- few of another member's details (e.g. a relative, or a leaked partial
-- record) could keep guessing the rest indefinitely.
--
-- lookupFailCount tracks consecutive failed submit_lookup_info attempts per
-- LINE account (the LINE userId itself can't be spoofed, unlike anything
-- typed in chat); lookupLockedUntil, once set, blocks further attempts
-- until it's in the past. Both default open (0 / NULL) so this is a no-op
-- for every existing row.
ALTER TABLE "LineUser" ADD COLUMN "lookupFailCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LineUser" ADD COLUMN "lookupLockedUntil" TIMESTAMP(3);
