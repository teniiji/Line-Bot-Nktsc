-- Who set a transfer's excludedReason: "slip" when the round took it from the
-- member's own slip for the same payment, "staff" when a person chose it (or
-- chose to count the money after all). Null on rows set before this, which
-- are treated as staff's.
ALTER TABLE "StatementTransfer" ADD COLUMN "reasonSource" TEXT;
