-- CreateTable
CREATE TABLE "PendingServiceRequest" (
    "id" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "requestType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingServiceRequest_lineUserId_key" ON "PendingServiceRequest"("lineUserId");
