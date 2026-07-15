-- AlterTable
ALTER TABLE "PendingServiceRequest" ADD COLUMN     "department" TEXT;

-- CreateTable
CREATE TABLE "OrganizationUnit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupName" TEXT,
    "contactMethod" TEXT,
    "contactName" TEXT,
    "email" TEXT,
    "lineUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberRoster" (
    "id" TEXT NOT NULL,
    "memberNumber" TEXT NOT NULL,
    "memberName" TEXT NOT NULL,
    "unitName" TEXT,
    "lineUserId" TEXT,
    "nickname" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberRoster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanDistrictContact" (
    "id" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanDistrictContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationUnit_name_key" ON "OrganizationUnit"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MemberRoster_memberNumber_key" ON "MemberRoster"("memberNumber");

-- CreateIndex
CREATE INDEX "MemberRoster_lineUserId_idx" ON "MemberRoster"("lineUserId");

-- CreateIndex
CREATE UNIQUE INDEX "LoanDistrictContact_district_key" ON "LoanDistrictContact"("district");
