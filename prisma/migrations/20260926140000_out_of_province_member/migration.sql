-- CreateTable
CREATE TABLE "OutOfProvinceMember" (
    "id" TEXT NOT NULL,
    "memberNumber" TEXT NOT NULL,
    "memberName" TEXT,
    "deductingUnit" TEXT NOT NULL,
    "originalUnit" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutOfProvinceMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutOfProvinceMember_memberNumber_key" ON "OutOfProvinceMember"("memberNumber");

-- CreateIndex
CREATE INDEX "OutOfProvinceMember_deductingUnit_idx" ON "OutOfProvinceMember"("deductingUnit");
