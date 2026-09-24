-- Marks a transfer whose memberNumber staff set directly (a split-off
-- payment, or a whole transfer moved to a different member) rather than one
-- read off the account directory, so rematchRoundTransfers knows to leave it
-- alone on the next statement upload.
ALTER TABLE "StatementTransfer" ADD COLUMN "manualMemberNumber" BOOLEAN NOT NULL DEFAULT false;
