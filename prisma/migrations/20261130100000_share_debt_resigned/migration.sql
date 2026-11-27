-- Members the share-and-debt report prints as having left.
ALTER TABLE "ShareDebtEntry" ADD COLUMN "resigned" BOOLEAN NOT NULL DEFAULT false;
