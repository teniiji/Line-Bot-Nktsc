-- ประกันและหลักประกัน: one imported round of insurance, cremation-association
-- and share/debt figures per member (see CoverageSnapshot in schema.prisma).
CREATE TABLE "CoverageSnapshot" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "asOf" TIMESTAMP(3),
    "ageAsOf" TIMESTAMP(3),
    "benefitSok" INTEGER NOT NULL DEFAULT 600000,
    "benefitScs" INTEGER NOT NULL DEFAULT 600000,
    "benefitSst" INTEGER NOT NULL DEFAULT 450000,
    "benefitSsk" INTEGER NOT NULL DEFAULT 350000,
    "welfarePerPeriod" INTEGER NOT NULL DEFAULT 2500,
    "welfareCap" INTEGER NOT NULL DEFAULT 600000,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CoverageSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemberCoverage" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "memberNumber" TEXT NOT NULL,
    "memberName" TEXT,
    "unitName" TEXT,
    "gender" TEXT,
    "age" INTEGER,
    "sharePeriods" INTEGER,
    "shares" DECIMAL(14,2) NOT NULL,
    "debt" DECIMAL(14,2),
    "insuredSum" INTEGER NOT NULL DEFAULT 0,
    "premium" INTEGER NOT NULL DEFAULT 0,
    "premiumDeducted" BOOLEAN,
    "hasSok" BOOLEAN NOT NULL DEFAULT false,
    "hasScs" BOOLEAN NOT NULL DEFAULT false,
    "hasSst" BOOLEAN NOT NULL DEFAULT false,
    "hasSsk" BOOLEAN NOT NULL DEFAULT false,
    "relativeCount" INTEGER NOT NULL DEFAULT 0,
    "relativeFees" INTEGER NOT NULL DEFAULT 0,
    "debtStatus" TEXT,
    "undeducted" TEXT,
    CONSTRAINT "MemberCoverage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MemberCoverage_snapshotId_memberNumber_key" ON "MemberCoverage"("snapshotId", "memberNumber");
CREATE INDEX "MemberCoverage_memberNumber_idx" ON "MemberCoverage"("memberNumber");

ALTER TABLE "MemberCoverage" ADD CONSTRAINT "MemberCoverage_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "CoverageSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
