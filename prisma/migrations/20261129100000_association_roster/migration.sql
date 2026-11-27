-- CreateTable
CREATE TABLE "AssociationRoster" (
    "id" TEXT NOT NULL,
    "association" TEXT NOT NULL DEFAULT 'ssc',
    "label" TEXT NOT NULL,
    "benefit" INTEGER NOT NULL,
    "asOf" TIMESTAMP(3),
    "fileName" TEXT,
    "counts" JSONB,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssociationRoster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssociationRosterMember" (
    "id" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "memberNumber" TEXT NOT NULL,
    "assocNumber" TEXT,
    "name" TEXT,
    "lastPeriod" TEXT,
    "monthly" INTEGER,

    CONSTRAINT "AssociationRosterMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssociationRoster_association_createdAt_idx" ON "AssociationRoster"("association", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssociationRosterMember_rosterId_memberNumber_key" ON "AssociationRosterMember"("rosterId", "memberNumber");

-- AddForeignKey
ALTER TABLE "AssociationRosterMember" ADD CONSTRAINT "AssociationRosterMember_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "AssociationRoster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
