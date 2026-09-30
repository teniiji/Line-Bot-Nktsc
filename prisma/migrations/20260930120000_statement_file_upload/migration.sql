-- Every รายการหัก / ผลการหัก file uploaded into a round, so a second upload of
-- the same file can say so before it is applied.
CREATE TABLE "StatementFileUpload" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatementFileUpload_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StatementFileUpload_roundId_idx" ON "StatementFileUpload"("roundId");
