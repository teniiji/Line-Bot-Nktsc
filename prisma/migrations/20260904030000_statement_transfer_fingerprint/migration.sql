-- Statement lines now carry their own identity so re-uploading a statement,
-- or uploading an overlapping date range, recognises lines it already has
-- instead of the round replacing one file's transfers with the next one's.

ALTER TABLE "StatementTransfer" ADD COLUMN "fingerprint" TEXT;
ALTER TABLE "StatementTransfer" ADD COLUMN "sourceFile" TEXT;

-- Existing rows predate fingerprints. Seeding them from their own id keeps
-- each one unique so the index below can be created; they simply will not
-- dedupe against a future upload, which is right — nothing records which
-- statement file they came from, so treating them as "already loaded" would
-- be a guess. Re-uploading that statement supersedes them by hand.
UPDATE "StatementTransfer" SET "fingerprint" = 'legacy|' || "id" WHERE "fingerprint" IS NULL;

ALTER TABLE "StatementTransfer" ALTER COLUMN "fingerprint" SET NOT NULL;

CREATE UNIQUE INDEX "StatementTransfer_roundId_fingerprint_key" ON "StatementTransfer"("roundId", "fingerprint");
