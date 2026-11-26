-- CreateTable
CREATE TABLE "CoverageEnrollment" (
    "id" TEXT NOT NULL,
    "memberNumber" TEXT NOT NULL,
    "memberName" TEXT,
    "unitName" TEXT,
    "age" INTEGER,
    "product" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'enroll',
    "applicationDate" TIMESTAMP(3) NOT NULL,
    "insuredSum" INTEGER,
    "annualPremium" INTEGER,
    "proratedPremium" INTEGER,
    "paymentMethod" TEXT,
    "relativeName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "statusDate" TIMESTAMP(3),
    "statusSource" TEXT,
    "eligibilityChecked" BOOLEAN NOT NULL DEFAULT false,
    "department" TEXT,
    "recordedBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoverageEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "CoverageEnrollment_applicationDate_idx" ON "CoverageEnrollment"("applicationDate");

-- CreateIndex
CREATE INDEX "CoverageEnrollment_memberNumber_idx" ON "CoverageEnrollment"("memberNumber");

-- CreateIndex
CREATE INDEX "CoverageEnrollment_product_status_idx" ON "CoverageEnrollment"("product", "status");
