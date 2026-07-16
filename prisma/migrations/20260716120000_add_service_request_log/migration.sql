-- CreateTable
CREATE TABLE "ServiceRequestLog" (
    "id" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "memberFullName" TEXT,
    "memberNumber" TEXT,
    "memberVerified" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "documentType" TEXT NOT NULL,
    "requestType" TEXT,
    "department" TEXT,
    "imageUrl" TEXT,
    "forwardedTo" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceRequestLog_createdAt_idx" ON "ServiceRequestLog"("createdAt");

-- CreateIndex
CREATE INDEX "ServiceRequestLog_lineUserId_idx" ON "ServiceRequestLog"("lineUserId");
