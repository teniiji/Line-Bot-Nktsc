-- The name of whoever sent a payment nobody could place yet (lib/senderName.ts).
CREATE TABLE "SenderName" (
    "id" TEXT NOT NULL,
    "accountNumber" TEXT,
    "lineId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SenderName_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SenderName_accountNumber_key" ON "SenderName"("accountNumber");
CREATE UNIQUE INDEX "SenderName_lineId_key" ON "SenderName"("lineId");
